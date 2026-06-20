#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import smtplib
import ssl
import sys
import json
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import os

try:
    config = json.loads(sys.argv[1])
    attachment_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

    msg = MIMEMultipart()
    msg['From'] = config['from']
    msg['To'] = config['to']
    if config.get('cc'):
        msg['Cc'] = config['cc']
    msg['Subject'] = config['subject']

    msg.attach(MIMEText(config['body'], 'plain', 'utf-8'))

    if attachment_path and os.path.exists(attachment_path):
        with open(attachment_path, 'rb') as f:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(f.read())
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{os.path.basename(attachment_path)}"')
            msg.attach(part)

    recipients = [r.strip() for r in config['to'].split(',')]
    if config.get('cc'):
        recipients += [r.strip() for r in config['cc'].split(',')]

    port = config['port']
    host = config['host']
    
    print(f"连接到 {host}:{port}...")
    
    # 根据端口选择连接方式
    # 465: SSL/TLS 直接加密连接
    # 587/25: STARTTLS 升级加密
    if port == 465:
        # SSL 直接连接 (用于 126、163、QQ 等国内邮箱)
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            print(f"登录 {config['username']}...")
            server.login(config['username'], config['password'])
            print(f"发送邮件到 {', '.join(recipients)}...")
            server.sendmail(config['from'], recipients, msg.as_string())
    else:
        # STARTTLS 连接 (用于 Gmail、Outlook 等)
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            print(f"登录 {config['username']}...")
            server.login(config['username'], config['password'])
            print(f"发送邮件到 {', '.join(recipients)}...")
            server.sendmail(config['from'], recipients, msg.as_string())
    
    print('✅ 邮件发送成功!')
    sys.exit(0)
except Exception as e:
    print(f'❌ 发送失败: {e}')
    sys.exit(1)
