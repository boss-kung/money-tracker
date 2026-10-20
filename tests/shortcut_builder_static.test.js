const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../scripts/build_ios_shortcuts.py'), 'utf8')

test('notification Shortcut guards empty automation input before HTTP', () => {
  const scriptPath = path.join(__dirname, '../scripts/build_ios_shortcuts.py')
  const probe = [
    'import importlib.util, json',
    `spec=importlib.util.spec_from_file_location("builder", ${JSON.stringify(scriptPath)})`,
    'mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'wf=mod.make_workflow("test", "line_notification", False)',
    'print(json.dumps(wf["WFWorkflowActions"]))',
  ].join(';')
  const actions = JSON.parse(execFileSync('python3', ['-c', probe], { encoding: 'utf8' }))
  const identifiers = actions.map(action => action.WFWorkflowActionIdentifier)
  assert.deepEqual(identifiers, [
    'is.workflow.actions.detect.text',
    'is.workflow.actions.conditional',
    'is.workflow.actions.dictionary',
    'is.workflow.actions.downloadurl',
    'is.workflow.actions.conditional',
    'is.workflow.actions.showresult',
    'is.workflow.actions.conditional',
  ])
  assert.deepEqual(actions.filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.conditional').map(action => action.WFWorkflowActionParameters.WFControlFlowMode), [0, 1, 2])
  assert.match(source, /"WFCondition": 100/)
  assert.match(source, /ไม่ได้รับข้อความจาก Notification Automation/)
  assert.match(source, /Magic Variable: Notification หรือ Text/)
})

test('generated workflows preserve the supported capture methods and screen action', () => {
  assert.match(source, /"line_notification"/)
  assert.match(source, /"whats_on_screen"/)
  assert.match(source, /is\.workflow\.actions\.getonscreencontext/)
  assert.match(source, /is\.workflow\.actions\.detect\.text/)
  assert.match(source, /ingest-shortcut-capture/)
  assert.match(source, /Bearer PASTE_DEVICE_TOKEN_HERE/)
})

test('production Shortcuts finish after sending instead of blocking on Quick Look', () => {
  const scriptPath = path.join(__dirname, '../scripts/build_ios_shortcuts.py')
  const probe = [
    'import importlib.util, json',
    `spec=importlib.util.spec_from_file_location("builder", ${JSON.stringify(scriptPath)})`,
    'mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'workflows=[mod.make_workflow("notification", "line_notification", False), mod.make_workflow("screen", "whats_on_screen", True)]',
    'print(json.dumps([[a["WFWorkflowActionIdentifier"] for a in wf["WFWorkflowActions"]] for wf in workflows]))',
  ].join(';')
  const identifiers = JSON.parse(execFileSync('python3', ['-c', probe], { encoding: 'utf8' }))

  assert.ok(!identifiers[0].includes('is.workflow.actions.previewdocument'))
  assert.equal(identifiers[1].at(-1), 'is.workflow.actions.downloadurl')
  assert.ok(!identifiers[1].includes('is.workflow.actions.previewdocument'))
})

test('network requests fail fast instead of leaving the Shortcut spinning for a minute', () => {
  const scriptPath = path.join(__dirname, '../scripts/build_ios_shortcuts.py')
  const probe = [
    'import importlib.util, json',
    `spec=importlib.util.spec_from_file_location("builder", ${JSON.stringify(scriptPath)})`,
    'mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'wf=mod.make_workflow("screen", "whats_on_screen", True)',
    'request=next(a for a in wf["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl")',
    'print(json.dumps(request["WFWorkflowActionParameters"]["WFTimeout"]))',
  ].join(';')

  assert.equal(JSON.parse(execFileSync('python3', ['-c', probe], { encoding: 'utf8' })), 15)
})
