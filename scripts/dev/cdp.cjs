// usage: node cdp.cjs <urlSubstring> <js expression>
const [, , match, expr] = process.argv
;(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json')).json()
  const t = list.find((x) => (match === 'MAIN' ? x.url === 'http://localhost:47399/' : x.url.includes(match)))
  if (!t) return console.log('no target', list.map((x) => x.url))
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id === 1) { console.log(JSON.stringify(d.result?.result?.value ?? d.result)); ws.close(); process.exit(0) }
  }
})()
