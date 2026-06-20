#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日报数据导入脚本 - 将 data.json 转换为 VS Code 扩展的 DailyLog 格式

输入格式 (data.json):
{
  "20260104": "完善远程工单仓库工程化代码，并且重构依赖部分组件",
  "20260105": "完善远程工单仓库工程化代码，增加本地打包...",
  ...
}
输出格式 (~/code/file/auto-script/work_log/YYYY-MM/YYYY-MM-DD.json):
{
  "date": "2026-01-04",
  "completed": ["完善远程工单仓库工程化代码，并且重构依赖部分组件"],
  "plan": [],
  "blockers": [],
  "notes": ""
}

用法:
  python3 import_daily_logs.py                    # 处理当前目录下所有 YYYY-MM/data.json
  python3 import_daily_logs.py 2026-01/data.json  # 处理指定文件
"""

import json
import os
import re
import sys
from pathlib import Path

# ========================================
# 🔧 配置区
# ========================================

# 输出目录（与 VS Code 扩展的 dailyWorkLog.storagePath 配置保持一致）
# 脚本所在目录即为输出目录
OUTPUT_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 是否覆盖已存在的文件
OVERWRITE_EXISTING = False

# ========================================
# 📅 工具函数
# ========================================

def parse_date_key(date_key: str) -> str:
    """将 '20260104' 格式转换为 '2026-01-04' 格式"""
    if len(date_key) != 8 or not date_key.isdigit():
        raise ValueError(f"无效的日期格式: {date_key}，期望 YYYYMMDD")
    return f"{date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}"


def split_tasks(content: str) -> list[str]:
    """
    将日报内容拆分为多个任务项
    支持的分隔符: 中文顿号、逗号、分号、换行、& 符号、数字编号等
    """
    if not content or not content.strip():
        return []
    
    # 按常见分隔符拆分（保留语义完整性）
    # 优先按换行拆分
    if '\n' in content:
        tasks = [t.strip() for t in content.split('\n') if t.strip()]
        if len(tasks) > 1:
            return tasks
    
    # 按 & 符号拆分（常用于多任务分隔）
    if ' & ' in content:
        tasks = [t.strip() for t in content.split('& ') if t.strip()]
        if len(tasks) > 1:
            return tasks
    
    # 按中文分隔符拆分（顿号、分号）
    # 注意：逗号可能在句子中间，需要更谨慎
    separators = ['；', ';', '、']
    for sep in separators:
        if sep in content:
            tasks = [t.strip() for t in content.split(sep) if t.strip()]
            if len(tasks) > 1:
                return tasks
    
    # 按数字编号拆分 (1. xxx 2. xxx 或 1、xxx 2、xxx)
    numbered_pattern = r'(?:^|\s)(?:\d+[.、)）]\s*)'
    if re.search(numbered_pattern, content):
        parts = re.split(numbered_pattern, content)
        tasks = [t.strip() for t in parts if t.strip()]
        if len(tasks) > 1:
            return tasks
    
    # 无法拆分，作为单个任务返回
    return [content.strip()]


def create_daily_log(date_str: str, content: str) -> dict:
    """创建 DailyLog 格式的数据"""
    tasks = split_tasks(content)
    
    return {
        "date": date_str,
        "completed": tasks,
        "plan": [],
        "blockers": [],
        "notes": "",
        "gitlog": [],
        "ailog": [],
        "origin_url": []
    }


def get_year_month_from_date(date_str: str) -> str:
    """从 '2026-01-04' 获取 '2026-01'"""
    return date_str[:7]


def process_data_file(data_file_path: str) -> dict:
    """
    处理单个 data.json 文件
    返回: { "成功": int, "跳过": int, "失败": int, "文件列表": list }
    """
    results = {"成功": 0, "跳过": 0, "失败": 0, "文件列表": []}
    
    print(f"\n📂 处理文件: {data_file_path}")
    
    if not os.path.exists(data_file_path):
        print(f"❌ 文件不存在: {data_file_path}")
        return results
    
    try:
        with open(data_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析错误: {e}")
        return results
    
    for date_key, content in data.items():
        try:
            # 解析日期
            date_str = parse_date_key(date_key)
            year_month = get_year_month_from_date(date_str)
            
            # 创建输出目录
            output_dir = os.path.join(OUTPUT_BASE_DIR, year_month)
            os.makedirs(output_dir, exist_ok=True)
            
            # 输出文件路径
            output_file = os.path.join(output_dir, f"{date_str}.json")
            
            # 检查是否已存在
            if os.path.exists(output_file) and not OVERWRITE_EXISTING:
                print(f"  ⏭️  {date_str} 已存在，跳过")
                results["跳过"] += 1
                continue
            
            # 创建 DailyLog
            daily_log = create_daily_log(date_str, content)
            
            # 写入文件
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(daily_log, f, ensure_ascii=False, indent=2)
            
            print(f"  ✅ {date_str} -> {len(daily_log['completed'])} 个任务")
            results["成功"] += 1
            results["文件列表"].append(output_file)
            
        except Exception as e:
            print(f"  ❌ {date_key} 处理失败: {e}")
            results["失败"] += 1
    
    return results


def find_data_files(base_dir: str) -> list[str]:
    """查找所有 YYYY-MM/data.json 文件"""
    data_files = []
    base_path = Path(base_dir)
    
    # 匹配 YYYY-MM 格式的目录
    for item in base_path.iterdir():
        if item.is_dir() and re.match(r'^\d{4}-\d{2}$', item.name):
            data_file = item / 'data.json'
            if data_file.exists():
                data_files.append(str(data_file))
    
    return sorted(data_files)


# ========================================
# 🚀 主函数
# ========================================

def main():
    print("=" * 50)
    print("📋 日报数据导入工具")
    print(f"📁 输出目录: {OUTPUT_BASE_DIR}")
    print(f"🔄 覆盖模式: {'开启' if OVERWRITE_EXISTING else '关闭'}")
    print("=" * 50)
    
    # 确定要处理的文件
    if len(sys.argv) > 1:
        # 命令行指定文件
        data_files = sys.argv[1:]
    else:
        # 自动查找当前目录下的 data.json 文件
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_files = find_data_files(script_dir)
        
        if not data_files:
            # 尝试当前目录
            data_files = find_data_files(os.getcwd())
        
        if not data_files:
            print("\n❌ 未找到任何 data.json 文件")
            print("用法:")
            print("  python3 import_daily_logs.py                    # 自动查找 YYYY-MM/data.json")
            print("  python3 import_daily_logs.py 2026-01/data.json  # 指定文件")
            sys.exit(1)
    
    # 处理所有文件
    total = {"成功": 0, "跳过": 0, "失败": 0}
    
    for data_file in data_files:
        result = process_data_file(data_file)
        total["成功"] += result["成功"]
        total["跳过"] += result["跳过"]
        total["失败"] += result["失败"]
    
    # 汇总
    print("\n" + "=" * 50)
    print("📊 导入完成!")
    print(f"  ✅ 成功: {total['成功']} 条")
    print(f"  ⏭️  跳过: {total['跳过']} 条")
    print(f"  ❌ 失败: {total['失败']} 条")
    print(f"\n📂 日志已保存到: {OUTPUT_BASE_DIR}")


if __name__ == "__main__":
    main()
