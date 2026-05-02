// Convert elapsed timer ticks (60 Hz) to "MM:SS".
// Mirrors the original BASIC formatting from snaker.bas lines 520-540, including
// its quirks: CoCo BASIC's STR$ prepends a leading space for non-negative integers,
// LEFT$(..., 3) truncates to the first 3 chars BEFORE narrowing to 2, so a 100-minute
// score formats as "10:00" (the first two significant digits), not "00:00". Single-
// digit minutes carry the BASIC leading space (e.g. " 1:00" for 60 seconds).
export function formatScore(ticks) {
  const sec = ticks / 60
  const totalMinutes = Math.floor(sec / 60)
  const remSeconds = Math.floor(sec - totalMinutes * 60)

  const mmRaw = (' ' + totalMinutes).slice(0, 3)             // LEFT$(STR$(N), 3)
  let mm = parseInt(mmRaw, 10) < 1 ? '00' : mmRaw            // IF VAL(M$) < 1 THEN M$="00"
  if (mm.length > 2) mm = mm.slice(-2)                       // IF LEN(M$) > 2 THEN M$=RIGHT$(M$,2)

  const ssRaw = (' ' + remSeconds).slice(0, 3)
  const ss = ssRaw.length < 3 ? '0' + ssRaw.slice(-1) : ssRaw.slice(-2)

  return mm + ':' + ss
}
