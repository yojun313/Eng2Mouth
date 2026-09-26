"""CSS 파일의 최상위 :hover 규칙을 @media (hover: hover) 안으로 옮긴다 (09-native-touch-feel §3).

    python3 scripts/wrap_hover.py static/shared/app.css static/shared/theme.css

- `.a:hover, .a:focus-visible` 처럼 섞인 선택자는 나눈다: hover 아닌 부분은 제자리, hover 부분만 바로 뒤에 감싼다 (순서 = 우선순위 유지).
- 이미 @media 안에 있는 규칙은 건드리지 않는다. 여러 번 실행해도 결과가 같다.
"""
import sys


def split_selectors(prelude: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in prelude:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip()); cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def wrap(css: str) -> tuple[str, int]:
    out, i, n, changed = [], 0, len(css), 0
    while i < n:
        # 주석 · 공백은 그대로
        if css.startswith("/*", i):
            j = css.find("*/", i + 2); j = n if j < 0 else j + 2
            out.append(css[i:j]); i = j; continue
        if css[i].isspace():
            out.append(css[i]); i += 1; continue
        # 규칙 머리(prelude) — '{' 또는 ';'(@import 등) 까지
        j = i
        while j < n and css[j] not in "{;":
            if css.startswith("/*", j):
                j = css.find("*/", j + 2) + 2
            else:
                j += 1
        if j >= n or css[j] == ";":
            out.append(css[i:j + 1]); i = j + 1; continue
        prelude = css[i:j].strip()
        # 짝이 맞는 '}' 찾기
        depth, k = 0, j
        while k < n:
            if css.startswith("/*", k):
                k = css.find("*/", k + 2) + 2; continue
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
                if depth == 0:
                    break
            k += 1
        block = css[j:k + 1]
        if not prelude.startswith("@") and ":hover" in prelude:
            sels = split_selectors(prelude)
            hov = [s for s in sels if ":hover" in s]
            rest = [s for s in sels if ":hover" not in s]
            piece = (", ".join(rest) + " " + block + "\n" if rest else "") + "@media (hover: hover) { " + ", ".join(hov) + " " + block + " }"
            out.append(piece); changed += 1
        else:
            out.append(css[i:k + 1])
        i = k + 1
    return "".join(out), changed


if __name__ == "__main__":
    for path in sys.argv[1:]:
        src = open(path, encoding="utf-8").read()
        new, changed = wrap(src)
        assert new.count("{") == new.count("}"), f"brace mismatch in {path}"
        open(path, "w", encoding="utf-8").write(new)
        print(f"{path}: {changed} rules wrapped")
