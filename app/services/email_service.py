import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings


def send_verification_email(receiver: str, code: str) -> bool:
    sender = settings.MAIL_SENDER
    password = settings.MAIL_PASSWORD
    if not sender or not password:
        return False

    msg = MIMEMultipart()
    msg["Subject"] = "[Eng2Mouth] 회원가입 인증 코드"
    msg["From"] = sender
    msg["To"] = receiver
    msg.attach(
        MIMEText(
            f"아래 인증 코드를 입력하여 회원가입을 완료해주세요.\n\n인증 코드: {code}\n\n"
            "Eng2Mouth — AI와 전화로 배우는 영어 회화",
            "plain",
        )
    )
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as server:
            server.starttls()
            server.login(sender, password)
            server.sendmail(sender, receiver, msg.as_string())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 메일 발송 실패: {e}")
        return False
