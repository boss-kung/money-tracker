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
    'is.workflow.actions.date',
    'is.workflow.actions.format.date',
    'is.workflow.actions.detect.text',
    'is.workflow.actions.conditional',
    'is.workflow.actions.dictionary',
    'is.workflow.actions.downloadurl',
    'is.workflow.actions.previewdocument',
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

test('both native workflows capture one offset-bearing date before posting', () => {
  const scriptPath = path.join(__dirname, '../scripts/build_ios_shortcuts.py')
  const probe = [
    'import importlib.util, json',
    `spec=importlib.util.spec_from_file_location("builder", ${JSON.stringify(scriptPath)})`,
    'mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)',
    'print(json.dumps([mod.make_workflow("notification", "line_notification", False), mod.make_workflow("manual", "whats_on_screen", True)]))',
  ].join(';')
  const workflows = JSON.parse(execFileSync('python3', ['-c', probe], { encoding: 'utf8' }))

  for (const workflow of workflows) {
    const actions = workflow.WFWorkflowActions
    const dateActions = actions.filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.date')
    const formatActions = actions.filter(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.format.date')
    assert.equal(dateActions.length, 1)
    assert.equal(formatActions.length, 1)
    const dateIndex = actions.indexOf(dateActions[0])
    const formatIndex = actions.indexOf(formatActions[0])
    const detectIndex = actions.findIndex(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.detect.text')
    const request = actions.find(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.downloadurl')
    assert.ok(dateIndex >= 0 && dateIndex < detectIndex)
    assert.ok(formatIndex > dateIndex && formatIndex < detectIndex)
    assert.equal(formatActions[0].WFWorkflowActionParameters.WFDateFormat, "yyyy-MM-dd'T'HH:mm:ssXXX")

    const formattedUuid = formatActions[0].WFWorkflowActionParameters.UUID
    const hasCapturedAtBinding = value => value?.WFValue?.Value?.attachmentsByRange?.['{0, 1}']?.OutputUUID === formattedUuid
    const dictionary = actions.find(action => action.WFWorkflowActionIdentifier === 'is.workflow.actions.dictionary')
    const dictionaryItems = dictionary.WFWorkflowActionParameters.WFItems.Value.WFDictionaryFieldValueItems
    assert.ok(dictionaryItems.some(item => item.WFKey.Value.string === 'captured_at' && hasCapturedAtBinding(item)))
    const requestItems = request.WFWorkflowActionParameters.WFJSONValues.Value.WFDictionaryFieldValueItems
    assert.ok(requestItems.some(item => item.WFKey.Value.string === 'captured_at' && hasCapturedAtBinding(item)))
  }

  assert.doesNotMatch(source, /202\d-\d\d-\d\dT\d\d:/)
  assert.match(source, /Bearer PASTE_DEVICE_TOKEN_HERE/)
})
