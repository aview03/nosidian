// usage: node shot.cjs <port> <match|MAIN> <out.png> [width height]
const fs = require('fs')
const [, , port, match, out, w, h] = process.argv
;(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = list.find((x) => (match === 'MAIN' ? x.type === 'page' && !/[?&](widget|popup)=/.test(x.url) : x.url.includes(match)))
  if (!t) return console.log('no target', list.map((x) => x.url))
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }))
  if (w) send(1, 'Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false })
  setTimeout(() => send(2, 'Page.captureScreenshot', { format: 'png' }), w ? 600 : 50)
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id === 2) { fs.writeFileSync(out, Buffer.from(d.result.data, 'base64')); console.log('saved', out); ws.close(); process.exit(0) }
  }
})()
