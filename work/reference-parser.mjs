import { createHash } from "node:crypto";

const CAPTURE_METHODS = new Set(["line_notification", "whats_on_screen"]);

const BLOCK_PATTERNS = {
  uob_thai:
    /มีการใช้บัตร\s+UOB-\d{4}[\s\S]*?วงเงินคงเหลือใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*THB/giu,
  uob_english:
    /You have spent[\s\S]*?Available credit:\s*THB\s*[\d,]+(?:\.\d{1,2})?/giu,
  scb_connect:
    /รายการเงิน(?:ออก|เข้า)\s*-?[\d,]+(?:\.\d{1,2})?\s*บาท[\s\S]*?ยอดเงินที่ใช้ได้\s*[\d,]+(?:\.\d{1,2})?\s*บาท/giu,
  line_wallet:
    /LINE Pay Purchase[\s\S]*?Balance:\s*(?:THB\s*)?[\d,]+(?:\.\d{1,2})?/giu,
};

function normalizeForParsing(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
}

function normalizeRelevantText(text) {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]*\n+/g, "\n")
    .trim();
}

function lastMatch(text, patterns) {
  const matches = patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0] })),
  );
  return matches.sort((left, right) => left.index - right.index).at(-1)?.text ?? null;
}

function amount(text) {
  if (!text) return null;
  const parsed = Number(text.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.abs(parsed).toFixed(2) : null;
}

function transactionDate(text) {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/u);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
}

function clean(value) {
  return value?.trim().replace(/[ \t]+/g, " ") || null;
}

function canonicalDescription(value) {
  return normalizeRelevantText(value ?? "").toLocaleLowerCase("en-US");
}

function fingerprint(payload) {
  if (payload.parse_status !== "complete") return null;
  const basis = [
    "v1",
    payload.source,
    payload.direction,
    payload.amount,
    payload.currency,
    payload.account_last4 ?? payload.card_last4 ?? "",
    payload.transaction_datetime ?? payload.captured_at.slice(0, 10),
    canonicalDescription(payload.description),
    createHash("sha256").update(normalizeRelevantText(payload.relevant_text)).digest("hex"),
  ].join("|");
  return createHash("sha256").update(basis).digest("hex");
}

function emptyPayload(input, capturedAt) {
  return {
    schema_version: "money-tracker.capture.v1",
    parser_version: "reference-parser-1.1.0",
    source: "unknown",
    bank: null,
    amount: null,
    currency: "THB",
    direction: "unknown",
    merchant: null,
    description: null,
    account_last4: null,
    card_last4: null,
    transaction_datetime: null,
    captured_at: capturedAt,
    capture_method: input.capture_method,
    raw_text: input.raw_text,
    relevant_text: null,
    parse_status: "invalid",
    dedupe_version: 1,
    dedupe_key: null,
  };
}

export function parseMoneyTrackerEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Input envelope must be a dictionary");
  }
  if (typeof input.raw_text !== "string" || !input.raw_text.trim()) {
    throw new TypeError("raw_text must be non-empty text");
  }
  if (!CAPTURE_METHODS.has(input.capture_method)) {
    throw new TypeError("capture_method must be line_notification or whats_on_screen");
  }

  const capturedAt =
    typeof input.captured_at === "string" && input.captured_at
      ? input.captured_at
      : new Date().toISOString();
  const parseText = normalizeForParsing(input.raw_text);
  const payload = emptyPayload(input, capturedAt);

  const block = lastMatch(parseText, Object.values(BLOCK_PATTERNS));
  if (block && /มีการใช้บัตร|You have spent/iu.test(block)) {
    const thai = block.includes("มีการใช้บัตร");
    payload.source = "uob_thai";
    payload.bank = "UOB";
    payload.amount = amount(
      block.match(
        thai
          ? /จำนวน\s*([\d,]+(?:\.\d{1,2})?)\s*THB/u
          : /spent\s+THB\s*([\d,]+(?:\.\d{1,2})?)/iu,
      )?.[1],
    );
    payload.merchant = clean(
      block.match(thai ? /ที่ร้าน\s*([^\n\r]+)/u : /\sat\s+(.+?)\s+on\s+\d{2}\//iu)?.[1],
    );
    payload.card_last4 = block.match(thai ? /UOB-(\d{4})/u : /ending\s+(\d{4})/iu)?.[1] ?? null;
    payload.direction = "debit";
  } else if (block && /รายการเงิน(?:ออก|เข้า)/u.test(block)) {
    const money = block.match(/รายการเงิน(ออก|เข้า)\s*-?([\d,]+(?:\.\d{1,2})?)\s*บาท/u);
    const credit = money?.[1] === "เข้า";
    payload.source = "scb_connect";
    payload.bank = "SCB";
    payload.amount = amount(money?.[2]);
    payload.direction = credit ? "credit" : "debit";
    payload.merchant = clean(
      block.match(credit ? /จากบัญชี\s+([^\n\r]+)/u : /เข้าบัญชี\s+([^\n\r]+)/u)?.[1],
    );
    payload.account_last4 =
      block.match(
        credit ? /เข้าบัญชี[^\n\r]*X-(\d{4})/u : /จากบัญชี[^\n\r]*X-(\d{4})/u,
      )?.[1] ?? null;
  } else if (block && /LINE Pay Purchase/iu.test(block)) {
    payload.source = "line_wallet";
    payload.amount = amount(
      block.match(/LINE Pay Purchase\s*(?:฿|THB\s*)?([\d,]+(?:\.\d{1,2})?)/iu)?.[1],
    );
    payload.merchant = clean(block.match(/Merchant:\s*([^\n\r]+)/iu)?.[1]);
    payload.direction = "debit";
  }

  payload.relevant_text = block ? normalizeRelevantText(block) : null;
  payload.description = payload.merchant;
  payload.transaction_datetime = block ? transactionDate(block) : null;
  if (payload.source !== "unknown" && payload.amount !== null && payload.amount > 0) {
    payload.parse_status = "complete";
  }
  payload.dedupe_key = fingerprint(payload);
  return payload;
}
