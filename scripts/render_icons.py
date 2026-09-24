"""SVG 한 장으로 홈 화면 아이콘 PNG 들을 만든다 (헤드리스 크롬 렌더링).

    uv run --with playwright python scripts/render_icons.py icon.svg out_dir/
    # 처음이면: uv run --with playwright python -m playwright install chromium

만드는 파일: apple-touch-icon.png(180), icon-192.png, icon-512.png, favicon-32.png
원본 SVG 는 꽉 찬 정사각형(모서리 둥글게 X, 투명 X)이어야 한다 — iOS 가 모서리를 직접 자른다.
"""
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

SIZES = [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png"), (32, "favicon-32.png")]


async def main(svg_path: Path, out_dir: Path) -> None:
    svg = svg_path.read_text(encoding="utf-8")
    out_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for size, name in SIZES:
            page = await browser.new_page(viewport={"width": size, "height": size})
            await page.set_content(
                f"<html><body style='margin:0;background:#000'><div style='width:{size}px;height:{size}px'>"
                f"{svg.replace('<svg ', '<svg width=100% height=100% ', 1)}</div></body></html>"
            )
            await page.screenshot(path=str(out_dir / name), omit_background=False)
            await page.close()
            print(f"✓ {out_dir / name} ({size}x{size})")
        await browser.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), Path(sys.argv[2])))
