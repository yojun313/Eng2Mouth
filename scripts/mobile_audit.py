"""모든 페이지를 휴대폰 크기(390x844)로 열어 가로 넘침 · 16px 미만 입력창 · JS 오류를 찾는다.

    uv run --with playwright python scripts/mobile_audit.py http://127.0.0.1:8000 out/ / /settings /git

로그인이 필요하면 환경 변수로:
    AUDIT_LOGIN_URL=/login AUDIT_USER=me AUDIT_PASS=secret AUDIT_USER_FIELD=#username AUDIT_PASS_FIELD=#password
노치 흉내(홈 화면 앱): AUDIT_SAFE_AREA=59,34  (top,bottom)
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

AUDIT_JS = """() => {
  const vw = document.documentElement.clientWidth;
  // 장식 요소(배경 blob 등, 클릭 안 되는 것)는 일부러 화면 밖에 걸쳐 둘 수 있다.
  // 스크롤 영역 안에서 잘리는 요소는 건너뛰지 않는다 — 글자가 잘리는 진짜 버그이기 때문.
  const decorative = (el) => getComputedStyle(el).pointerEvents === 'none';
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > vw + 1 && !decorative(el)
        && !el.closest('.overflow-x-auto, .overflow-auto, .no-scrollbar, pre, table, [data-audit-ignore]')) {
      wide.push(`${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
    }
  }
  const small = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), textarea, select')]
    .filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.name} ${getComputedStyle(el).fontSize}`);
  return { docWidth: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 10), smallInputs: small };
}"""


async def main(base: str, out: Path, paths: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            color_scheme="dark",
        )
        page = await ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        if os.getenv("AUDIT_SAFE_AREA"):
            top, bottom = (int(v) for v in os.environ["AUDIT_SAFE_AREA"].split(","))
            cdp = await ctx.new_cdp_session(page)
            await cdp.send(
                "Emulation.setSafeAreaInsetsOverride",
                {"insets": {"top": top, "bottom": bottom, "left": 0, "right": 0}},
            )
        if os.getenv("AUDIT_LOGIN_URL"):
            await page.goto(base + os.environ["AUDIT_LOGIN_URL"])
            await page.fill(
                os.getenv("AUDIT_USER_FIELD", "#username"), os.environ["AUDIT_USER"]
            )
            await page.fill(
                os.getenv("AUDIT_PASS_FIELD", "#password"), os.environ["AUDIT_PASS"]
            )
            await page.click("button[type=submit]")
            await page.wait_for_load_state("networkidle")
        report = {}
        for path in paths:
            await page.goto(base + path)
            await page.wait_for_timeout(2000)
            report[path] = await page.evaluate(AUDIT_JS)
            await page.screenshot(
                path=str(
                    out / f"mobile_{path.strip('/').replace('/', '_') or 'index'}.png"
                )
            )
        print(json.dumps(report, ensure_ascii=False, indent=1))
        bad = {
            k: v
            for k, v in report.items()
            if v["wide"] or v["smallInputs"] or v["docWidth"] > v["vw"]
        }
        print(
            "\n문제 없음 ✓"
            if not bad and not errors
            else f"\n문제 페이지: {list(bad)}  JS 오류: {errors}"
        )
        await browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1].rstrip("/"), Path(sys.argv[2]), sys.argv[3:] or ["/"]))
