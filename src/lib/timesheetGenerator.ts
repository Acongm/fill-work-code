import * as path from 'path';
import * as os from 'os';

 
const ExcelJS = require('exceljs');

interface TimesheetConfig {
  year: number;
  month: number;
  pspName: string;
  pspCompany: string;
  owner: string;
  approver: string;
  projectName: string;
  defaultHours: number;
  includeLoggedNonWorkdays: boolean;
}

interface HolidayData {
  holidays: Set<string>; // YYYY-MM-DD format
  workingDays: Set<string>; // YYYY-MM-DD format
}

interface MonthlyTaskData {
  [dateKey: string]: string; // "20260101" -> "任务1 & 任务2"
}

export class TimesheetGenerator {
  private config: TimesheetConfig;
  private weekendDays = new Set([0, 6]); // Sunday=0, Saturday=6

  constructor(config: Partial<TimesheetConfig> = {}) {
    this.config = {
      year: config.year || new Date().getFullYear(),
      month: config.month || new Date().getMonth() + 1,
      pspName: config.pspName || 'PSP Name',
      pspCompany: config.pspCompany || 'PSP Company',
      owner: config.owner || 'Starbucks Owner',
      approver: config.approver || 'Liangyu Chen',
      projectName: config.projectName || '星巴克研发效能平台',
      defaultHours: config.defaultHours || 8,
      includeLoggedNonWorkdays: config.includeLoggedNonWorkdays || false
    };
  }

  /**
   * 从线上 API 获取节假日信息
   */
  private async fetchHolidayData(): Promise<HolidayData> {
    const holidays = new Set<string>();
    const workingDays = new Set<string>();

    try {
      const https = await import('https');
      const url = `https://timor.tech/api/holiday/year/${this.config.year}`;
      
      const data = await new Promise<any>((resolve, reject) => {
        https.get(url, { timeout: 5000 }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
      });

      if (data.code === 0 && data.holiday) {
        for (const [_, dayInfo] of Object.entries<any>(data.holiday)) {
          if (dayInfo.date) {
            if (dayInfo.holiday === true) {
              holidays.add(dayInfo.date);
            } else if (dayInfo.holiday === false) {
              workingDays.add(dayInfo.date);
            }
          }
        }
      }
    } catch (e) {
      console.warn('无法获取节假日数据，将使用默认周末判断:', e);
    }

    return { holidays, workingDays };
  }

  /**
   * 判断是否为工作日
   */
  private isWorkday(date: Date, holidayData: HolidayData): boolean {
    const dateStr = this.formatDate(date);
    
    // 如果是补班日，则为工作日
    if (holidayData.workingDays.has(dateStr)) {
      return true;
    }
    
    // 如果是节假日，则不是工作日
    if (holidayData.holidays.has(dateStr)) {
      return false;
    }
    
    // 检查是否为周末
    const dayOfWeek = date.getDay();
    return !this.weekendDays.has(dayOfWeek);
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 格式化日期为 YYYYMMDD
   */
  private formatDateKey(date: Date): string {
    return this.formatDate(date).replace(/-/g, '');
  }

  /**
   * 获取当月所有工作日
   */
  private async getWorkdays(monthlyData: MonthlyTaskData): Promise<Date[]> {
    const holidayData = await this.fetchHolidayData();
    const workdays: Date[] = [];

    const startDate = new Date(this.config.year, this.config.month - 1, 1);
    const endDate = new Date(this.config.year, this.config.month, 0);

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateKey = this.formatDateKey(currentDate);
      const hasLogged = Boolean(monthlyData[dateKey]);
      if (this.isWorkday(currentDate, holidayData) || (this.config.includeLoggedNonWorkdays && hasLogged)) {
        workdays.push(new Date(currentDate));
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return workdays;
  }

  /**
   * 将工作日按连续天数分组为周
   */
  private groupWorkdaysByWeek(workdays: Date[]): Date[][] {
    if (workdays.length === 0) {
      return [];
    }

    const weeks: Date[][] = [];
    let currentWeek = [workdays[0]];

    for (let i = 1; i < workdays.length; i++) {
      const prevDay = workdays[i - 1];
      const currDay = workdays[i];
      const daysDiff = Math.floor((currDay.getTime() - prevDay.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        currentWeek.push(currDay);
      } else {
        weeks.push(currentWeek);
        currentWeek = [currDay];
      }
    }
    weeks.push(currentWeek);

    return weeks;
  }

  /**
   * 生成工时表 Excel
   */
  async generate(monthlyData: MonthlyTaskData, outputPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('工作日志');

    // 列宽设置
    worksheet.columns = [
      { width: 22 }, // Week
      { width: 22 }, // Date
      { width: 22 }, // Project
      { width: 45 }, // Detail
      { width: 15 }, // Hours
      { width: 15 }  // Approval
    ];

    // 字体样式
    const font12 = { name: '宋体', size: 12 };
    const boldFont12 = { name: '宋体', size: 12, bold: true };
    const font14 = { name: 'Arial', size: 14 };
    const boldFont14 = { name: 'Arial', size: 14, bold: true };
    const centerAlign: Partial<any> = { vertical: 'middle', horizontal: 'center', wrapText: true };
    const headerFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    const thinBorder: Partial<any> = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };

    // 顶部三行
    worksheet.getRow(1).height = 25.5;
    worksheet.getRow(2).height = 25.5;
    worksheet.getRow(3).height = 25.5;

    worksheet.mergeCells('A1:B1');
    worksheet.mergeCells('A2:B2');
    worksheet.mergeCells('A3:B3');
    worksheet.mergeCells('C1:D1');
    worksheet.mergeCells('C2:D2');
    worksheet.mergeCells('C3:D3');

    worksheet.getCell('A1').value = this.config.pspName;
    worksheet.getCell('A1').font = boldFont14;
    worksheet.getCell('A1').alignment = centerAlign;

    worksheet.getCell('C1').value = this.config.pspName;
    worksheet.getCell('C1').font = boldFont14;
    worksheet.getCell('C1').alignment = centerAlign;

    worksheet.getCell('A2').value = this.config.pspCompany;
    worksheet.getCell('A2').font = boldFont14;
    worksheet.getCell('A2').alignment = centerAlign;

    worksheet.getCell('C2').value = this.config.pspCompany;
    worksheet.getCell('C2').font = boldFont14;
    worksheet.getCell('C2').alignment = centerAlign;

    worksheet.getCell('A3').value = this.config.owner;
    worksheet.getCell('A3').font = boldFont14;
    worksheet.getCell('A3').alignment = centerAlign;

    worksheet.getCell('C3').value = this.config.approver;
    worksheet.getCell('C3').font = boldFont14;
    worksheet.getCell('C3').alignment = centerAlign;

    // 表头（第5行）
    worksheet.getRow(5).height = 25.5;
    const headers = ['Week', 'Date', 'Project Name', 'Detail Description', 'Working Hours', 'Approval'];
    headers.forEach((header, idx) => {
      const cell = worksheet.getCell(5, idx + 1);
      cell.value = header;
      cell.font = boldFont12;
      cell.fill = headerFill;
      cell.alignment = centerAlign;
      cell.border = thinBorder;
    });

    // 获取工作日数据
    const workdays = await this.getWorkdays(monthlyData);
    const weeks = this.groupWorkdaysByWeek(workdays);

    let currentRow = 6;
    const weekRanges: [number, number][] = [];
    const approvalStartRow = currentRow;

    // 填充数据
    weeks.forEach((week, weekIdx) => {
      const weekLabel = `Week${weekIdx + 1}`;
      const weekStartRow = currentRow;

      week.forEach(day => {
        const dateKey = this.formatDateKey(day);
        const detailDescription = monthlyData[dateKey] || '';

        worksheet.getRow(currentRow).height = 25.5;
        
        worksheet.getCell(currentRow, 1).value = weekLabel;
        worksheet.getCell(currentRow, 2).value = dateKey;
        worksheet.getCell(currentRow, 3).value = this.config.projectName;
        worksheet.getCell(currentRow, 4).value = detailDescription;
        worksheet.getCell(currentRow, 5).value = this.config.defaultHours;
        worksheet.getCell(currentRow, 6).value = this.config.approver;

        for (let col = 1; col <= 6; col++) {
          const cell = worksheet.getCell(currentRow, col);
          cell.font = font12;
          cell.alignment = centerAlign;
          cell.border = thinBorder;
        }

        currentRow++;
      });

      weekRanges.push([weekStartRow, currentRow - 1]);
    });

    const approvalEndRow = currentRow - 1;

    // 合并 Week 列
    weekRanges.forEach(([start, end]) => {
      if (start !== end) {
        worksheet.mergeCells(start, 1, end, 1);
      }
    });

    // 合并 Approval 列
    if (approvalStartRow <= approvalEndRow) {
      worksheet.mergeCells(approvalStartRow, 6, approvalEndRow, 6);
    }

    // 合计行
    const totalDays = workdays.length;
    const totalHours = totalDays * this.config.defaultHours;
    const totalHoursRow = currentRow;
    const totalDaysRow = currentRow + 1;

    worksheet.getRow(totalHoursRow).height = 25.5;
    worksheet.getRow(totalDaysRow).height = 25.5;

    worksheet.mergeCells(totalHoursRow, 1, totalHoursRow, 4);
    worksheet.getCell(totalHoursRow, 1).value = 'Total Hours';
    worksheet.getCell(totalHoursRow, 1).font = boldFont12;
    worksheet.getCell(totalHoursRow, 1).alignment = centerAlign;
    worksheet.getCell(totalHoursRow, 1).fill = headerFill;
    worksheet.getCell(totalHoursRow, 1).border = thinBorder;
    
    worksheet.getCell(totalHoursRow, 5).value = totalHours;
    worksheet.getCell(totalHoursRow, 5).font = boldFont12;
    worksheet.getCell(totalHoursRow, 5).alignment = centerAlign;
    worksheet.getCell(totalHoursRow, 5).fill = headerFill;
    worksheet.getCell(totalHoursRow, 5).border = thinBorder;
    
    worksheet.getCell(totalHoursRow, 6).value = 'Hours';
    worksheet.getCell(totalHoursRow, 6).font = boldFont12;
    worksheet.getCell(totalHoursRow, 6).alignment = centerAlign;
    worksheet.getCell(totalHoursRow, 6).fill = headerFill;
    worksheet.getCell(totalHoursRow, 6).border = thinBorder;

    worksheet.mergeCells(totalDaysRow, 1, totalDaysRow, 4);
    worksheet.getCell(totalDaysRow, 1).value = 'Total Days';
    worksheet.getCell(totalDaysRow, 1).font = boldFont12;
    worksheet.getCell(totalDaysRow, 1).alignment = centerAlign;
    worksheet.getCell(totalDaysRow, 1).fill = headerFill;
    worksheet.getCell(totalDaysRow, 1).border = thinBorder;
    
    worksheet.getCell(totalDaysRow, 5).value = totalDays;
    worksheet.getCell(totalDaysRow, 5).font = boldFont12;
    worksheet.getCell(totalDaysRow, 5).alignment = centerAlign;
    worksheet.getCell(totalDaysRow, 5).fill = headerFill;
    worksheet.getCell(totalDaysRow, 5).border = thinBorder;
    
    worksheet.getCell(totalDaysRow, 6).value = 'Days';
    worksheet.getCell(totalDaysRow, 6).font = boldFont12;
    worksheet.getCell(totalDaysRow, 6).alignment = centerAlign;
    worksheet.getCell(totalDaysRow, 6).fill = headerFill;
    worksheet.getCell(totalDaysRow, 6).border = thinBorder;

    // 保存文件
    await workbook.xlsx.writeFile(outputPath);
  }

  /**
   * 生成默认输出路径
   */
  static getDefaultOutputPath(year: number, month: number): string {
    const homeDir = os.homedir();
    const workLogDir = path.join(homeDir, '.work-logs', `${year}-${String(month).padStart(2, '0')}`);
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    return path.join(workLogDir, `Timesheet-${year}${String(month).padStart(2, '0')}_${timestamp}.xlsx`);
  }
}
