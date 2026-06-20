#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
月度日志汇总脚本 - 从 ~/.work-logs/YYYY-MM/ 读取所有日志并生成月度汇总 JSON
"""

import json
import os
from pathlib import Path
from datetime import datetime

# ========================================
# 🔧 配置区
# ========================================

YEAR = 2026
MONTH = 1

# 工作日志存储目录（与 VS Code 扩展配置一致）
WORK_LOGS_DIR = os.path.expanduser('~/.work-logs')

# ========================================
# 📊 主函数
# ========================================

def generate_monthly_summary(year, month):
    """
    从 ~/.work-logs/YYYY-MM/ 目录读取所有日志文件，生成月度汇总 JSON
    
    输出格式：
    {
      "20260101": "任务1 & 任务2 & 任务3",
      "20260102": "任务4 & 任务5",
      ...
    }
    """
    month_str = f"{year}-{month:02d}"
    source_dir = Path(WORK_LOGS_DIR) / month_str
    
    if not source_dir.exists():
        print(f"❌ 目录不存在: {source_dir}")
        return None
    
    monthly_data = {}
    json_files = sorted(source_dir.glob("*.json"))
    
    if not json_files:
        print(f"⚠️  {source_dir} 目录下没有找到日志文件")
        return None
    
    print(f"📂 正在处理 {len(json_files)} 个日志文件...")
    
    for json_file in json_files:
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                log = json.load(f)
            
            # 提取日期和已完成任务
            date = log.get('date', '')
            completed = log.get('completed', [])
            
            if date and completed:
                # 转换日期格式：2026-01-01 -> 20260101
                date_key = date.replace('-', '')
                # 用 & 连接所有任务
                tasks_str = ' & '.join(completed)
                monthly_data[date_key] = tasks_str
                print(f"  ✓ {date}: {len(completed)} 个任务")
            
        except Exception as e:
            print(f"  ⚠️  跳过文件 {json_file.name}: {e}")
            continue
    
    return monthly_data


def save_monthly_summary(year, month, data):
    """
    保存月度汇总到 work_log/YYYY-MM/ 目录
    """
    # 保存到当前脚本所在目录的 YYYY-MM 子目录
    script_dir = Path(__file__).parent
    output_dir = script_dir / f"{year}-{month:02d}"
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / f"{year}-{month:02d}.json"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 月度汇总已保存: {output_file}")
    print(f"📊 共 {len(data)} 个工作日记录")
    
    return output_file


def main():
    print(f"🚀 开始生成 {YEAR}年{MONTH}月 工作日志汇总...\n")
    
    # 生成月度汇总数据
    monthly_data = generate_monthly_summary(YEAR, MONTH)
    
    if not monthly_data:
        print("\n❌ 未生成任何数据，请检查日志目录")
        return
    
    # 保存到文件
    save_monthly_summary(YEAR, MONTH, monthly_data)


if __name__ == "__main__":
    main()
