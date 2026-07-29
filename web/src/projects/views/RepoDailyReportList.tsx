import * as React from 'react';
import type { RepoDailyReportDay } from '../utils/extractRepoDailyReports';

interface RepoDailyReportListProps {
  reports: RepoDailyReportDay[];
}

export const RepoDailyReportList: React.FC<RepoDailyReportListProps> = ({
  reports,
}) => {
  if (reports.length === 0) {
    return <p className="empty-hint">暂无仓库日报，选择日期后点击「生成工作日志」</p>;
  }

  return (
    <div className="repo-daily-reports">
      {reports.map((report) => (
        <article key={report.date} className="repo-daily-report-day">
          <h5 className="repo-daily-report-date">{report.date}</h5>
          <ul className="repo-daily-report-logs">
            {report.logs.map((log) => (
              <li key={`${report.date}:${log}`}>{log}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
};
