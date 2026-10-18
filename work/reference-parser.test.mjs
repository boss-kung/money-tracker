import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parseMoneyTrackerEnvelope } from "./reference-parser.mjs";

const expected = JSON.parse(
  await readFile(new URL("../outputs/money-tracker-test-fixtures.json", import.meta.url)),
);

for (const fixtureCase of expected.cases) {
  test(fixtureCase.fixture, async () => {
    const fixtureUrl = new URL(fixtureCase.fixture.replace("work/", ""), import.meta.url);
    const input = JSON.parse(await readFile(fixtureUrl));
    const actual = parseMoneyTrackerEnvelope(input);

    for (const [key, value] of Object.entries(fixtureCase.expected)) {
      assert.deepEqual(key === "latest_block_amount" ? actual.amount : actual[key], value, key);
    }

    assert.equal(actual.schema_version, "money-tracker.capture.v1");
    assert.equal(actual.parser_version, "reference-parser-1.0.0");
    assert.equal(actual.capture_method, input.capture_method);
    assert.equal(actual.raw_text, input.raw_text);

    if (actual.parse_status === "complete") {
      assert.match(actual.dedupe_key, /^[a-f0-9]{64}$/);
    } else {
      assert.equal(actual.dedupe_key, null);
    }
  });
}

test("notification and screen text share the same canonical dedupe key", () => {
  const transaction = [
    "รายการเงินออก -80.00 บาท",
    "จากบัญชี THANAPHORN U. X-4078",
    "เข้าบัญชี MBR9",
    "วันที่/เวลา 05/10/2026 21:39",
    "ยอดเงินที่ใช้ได้ 1,088.37 บาท",
  ].join("\n");

  const shared = { captured_at: "2026-10-05T21:40:00+07:00", force_test: true };
  const notification = parseMoneyTrackerEnvelope({
    ...shared,
    raw_text: transaction,
    capture_method: "line_notification",
  });
  const screen = parseMoneyTrackerEnvelope({
    ...shared,
    raw_text: `SCB Connect\nเมนูหลัก\n${transaction}\nหน้าแรก\nค้นหา`,
    capture_method: "whats_on_screen",
  });

  assert.equal(screen.dedupe_key, notification.dedupe_key);
});

test("rejects malformed input at the trust boundary", () => {
  assert.throws(() => parseMoneyTrackerEnvelope(null), /input envelope/i);
  assert.throws(
    () => parseMoneyTrackerEnvelope({ raw_text: "x", capture_method: "email" }),
    /capture_method/i,
  );
});
