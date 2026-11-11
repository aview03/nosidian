// usage: node scripts/dev/inject-fixture.cjs <cdpPort> <fixtureDir> <vaultName> [persona=developer]
// 폴더 안의 .md 파일들을 새 보관함(vault)에 노트로 넣는다. 기존 보관함은 건드리지 않는다. PC(9333)·폰(9444, adb forward) 어느 쪽이든 같은 데이터가 들어간다.
// 앞서 앱에 localStorage nosidian.dev=1 을 넣고 다시 불러서 개발용 훅(window.__proposals)이 켜져 있어야 한다.
const fs = require('fs')
const path = require('path')
const [, , port, dir, vaultName, persona = 'developer'] = process.argv

function walk(root, rel = '') {
  const out = []
  for (const name of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${name.name}` : name.name
    if (name.isDirectory()) out.push(...walk(root, r))
    else if (name.name.endsWith('.md')) out.push([r, fs.readFileSync(path.join(root, r), 'utf8').replace(/\r\n/g, '\n')])
  }
  return out
}

;(async () => {
  const files = walk(dir)
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = list.find((x) => x.type === 'page' && !/[?&](widget|popup)=/.test(x.url))
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  const expr = `(async function(files, name){
    const app = window.__proposals && window.__proposals.app
    if (!app) return 'dev hook off'
    await app.getState().addVault(name, { silent: true })
    for (const [p, c] of files) app.getState().createNote(p, c, false)
    app.getState().patchSettings({ myName: '동민', persona: ${JSON.stringify(persona)} })
    return Object.keys(app.getState().files).length + ' notes in vault ' + app.getState().settings.activeVault
  })(${JSON.stringify(files)}, ${JSON.stringify(vaultName)})`
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id === 1) {
      console.log(JSON.stringify(d.result?.result?.value ?? d.result))
      process.exit(0)
    }
  }
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  console.log(`injecting ${files.length} files…`)
})()
