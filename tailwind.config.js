/** Tailwind (독립 실행 CLI 빌드). 템플릿과 JS 에 쓰인 클래스만 포함된다 → 새 클래스를 쓰면 scripts/build_css.sh 재실행 */
module.exports = {
  // hover: 변형을 @media (hover:hover) and (pointer:fine) 안으로 → 휴대폰에서 탭한 뒤 hover 색이 남지 않는다 (09)
  future: { hoverOnlyWhenSupported: true },
  content: ['./app/templates/**/*.html', './static/js/**/*.js', './static/shared/**/*.js'],
  safelist: [
    // 데이터(페르소나 gradient 등)에서 오는 클래스는 빌드가 못 찾으므로 명시
    { pattern: /^(from|to|via)-(pink|orange|indigo|blue|emerald|teal|slate|cyan|amber|red|violet|purple|sky|rose|fuchsia|green)-(200|300|400|500|600)$/ },
    { pattern: /^(bg|text|border)-(emerald|blue|amber|red|purple|pink|cyan|orange|teal|sky|indigo|violet|rose|fuchsia|slate|yellow|green)-(200|300|400|500|600)(\/(10|15|20|25|30|40|50|60|70|80|90))?$/ },
    'bg-gradient-to-br', 'bg-gradient-to-r', 'bg-gradient-to-t', 'line-through', 'decoration-red-400/60', 'rotate-180', 'opacity-70', 'opacity-50',
  ],
  theme: { extend: { colors: { dark: '#05070f', card: '#0f1424', sidebar: '#0a0e1a' }, fontFamily: { sans: ['Inter', 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'system-ui', '-apple-system', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'D2Coding', 'monospace'] } } },
  plugins: [],
};
