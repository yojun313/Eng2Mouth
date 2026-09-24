import os

from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "7005")),
        reload=False,
        proxy_headers=True,
        forwarded_allow_ips="*",
        server_header=False,
        date_header=False,
    )
