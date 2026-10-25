#!/usr/bin/env python3
"""Build the two native Money Tracker Shortcuts and sign them with macOS Shortcuts."""

from __future__ import annotations

import plistlib
import subprocess
import sys
import uuid
from pathlib import Path


ENDPOINT = "https://bwtoyxxwwmsaoaitihqj.supabase.co/functions/v1/ingest-shortcut-capture"
TOKEN_PLACEHOLDER = "Bearer PASTE_DEVICE_TOKEN_HERE"


def uid() -> str:
    return str(uuid.uuid4()).upper()


def text_field(value: str) -> dict:
    return {
        "Value": {"string": value},
        "WFSerializationType": "WFTextTokenString",
    }


def token_field(output_uuid: str, output_name: str) -> dict:
    return {
        "Value": {
            "string": "\ufffc",
            "attachmentsByRange": {
                "{0, 1}": {
                    "OutputUUID": output_uuid,
                    "Type": "ActionOutput",
                    "OutputName": output_name,
                }
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def direct_token(output_uuid: str, output_name: str) -> dict:
    return {
        "Value": {
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
            "OutputName": output_name,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def field_item(key: str, value: dict | str, item_type: int = 0) -> dict:
    return {
        "WFItemType": item_type,
        "WFKey": text_field(key),
        "WFValue": text_field(value) if isinstance(value, str) else value,
    }


def field_dict(items: list[dict]) -> dict:
    return {
        "Value": {"WFDictionaryFieldValueItems": items},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def current_date_action(action_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.date",
        "WFWorkflowActionParameters": {"UUID": action_uuid},
    }


def format_date_action(action_uuid: str, date_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": direct_token(date_uuid, "Date"),
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": "yyyy-MM-dd'T'HH:mm:ssXXX",
            "WFDateFormatTimeZone": "Asia/Bangkok",
        },
    }


def dictionary_action(action_uuid: str, raw_uuid: str, capture_method: str, captured_at_uuid: str) -> dict:
    items = [
        field_item("raw_text", token_field(raw_uuid, "Text")),
        field_item("capture_method", capture_method),
        field_item("captured_at", token_field(captured_at_uuid, "Formatted Date")),
    ]
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "WFItems": field_dict(items),
            "UUID": action_uuid,
        },
    }


def request_action(action_uuid: str, raw_text_uuid: str, capture_method: str, captured_at_uuid: str) -> dict:
    headers = field_dict([
        field_item("Authorization", TOKEN_PLACEHOLDER),
        field_item("Content-Type", "application/json"),
    ])
    body = field_dict([
        field_item("raw_text", token_field(raw_text_uuid, "Text")),
        field_item("capture_method", capture_method),
        field_item("captured_at", token_field(captured_at_uuid, "Formatted Date")),
    ])
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFURL": ENDPOINT,
            "WFHTTPMethod": "POST",
            "ShowHeaders": True,
            "WFHTTPHeaders": headers,
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": body,
            "WFAllowsCellularAccess": 1,
            "WFAllowsRedirects": 1,
            "WFIgnoreCookies": 0,
            "WFTimeout": 60,
        },
    }


def quick_look_action(request_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.previewdocument",
        "WFWorkflowActionParameters": {
            "WFInput": direct_token(request_uuid, "Contents of URL"),
        },
    }


def conditional_action(action_uuid: str, grouping_uuid: str, mode: int, text_uuid: str | None = None) -> dict:
    parameters = {
        "UUID": action_uuid,
        "GroupingIdentifier": grouping_uuid,
        "WFControlFlowMode": mode,
    }
    if mode == 0:
        parameters.update({
            "WFCondition": 100,
            "WFInput": direct_token(text_uuid or "", "Text"),
        })
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": parameters,
    }


def show_result_action(message: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
        "WFWorkflowActionParameters": {"Text": text_field(message)},
    }


def make_workflow(name: str, capture_method: str, manual: bool) -> dict:
    date_uuid = uid()
    formatted_date_uuid = uid()
    screen_uuid = uid()
    text_uuid = uid()
    dictionary_uuid = uid()
    request_uuid = uid()

    actions: list[dict] = [
        current_date_action(date_uuid),
        format_date_action(formatted_date_uuid, date_uuid),
    ]
    if manual:
        actions.append(
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.getonscreencontext",
                "WFWorkflowActionParameters": {
                    "WFOnScreenContextResultType": "Text",
                    "UUID": screen_uuid,
                },
            }
        )
    actions.append(
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.text",
            "WFWorkflowActionParameters": {
                "CustomOutputName": "Text",
                "UUID": text_uuid,
            },
        }
    )
    if manual:
        actions.extend([
            dictionary_action(dictionary_uuid, text_uuid, capture_method, formatted_date_uuid),
            request_action(request_uuid, text_uuid, capture_method, formatted_date_uuid),
            quick_look_action(request_uuid),
        ])
    else:
        grouping_uuid = uid()
        actions.extend([
            conditional_action(uid(), grouping_uuid, 0, text_uuid),
            dictionary_action(dictionary_uuid, text_uuid, capture_method, formatted_date_uuid),
            request_action(request_uuid, text_uuid, capture_method, formatted_date_uuid),
            quick_look_action(request_uuid),
            conditional_action(uid(), grouping_uuid, 1),
            show_result_action(
                "Money Tracker: ไม่ได้รับข้อความจาก Notification Automation\n"
                "ตรวจว่า Run Shortcut ส่ง Magic Variable: Notification หรือ Text แล้วลองใหม่"
            ),
            conditional_action(uid(), grouping_uuid, 2),
        ])

    return {
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowName": name,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": -615917313,
            "WFWorkflowIconGlyphNumber": 61440,
        },
        "WFWorkflowClientVersion": "5037.0.19",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowActions": actions,
        "WFWorkflowInputContentItemClasses": [
            "WFAppContentItem",
            "WFAppStoreAppContentItem",
            "WFArticleContentItem",
            "WFContactContentItem",
            "WFDateContentItem",
            "WFEmailAddressContentItem",
            "WFFolderContentItem",
            "WFGenericFileContentItem",
            "WFImageContentItem",
            "WFiTunesProductContentItem",
            "WFLocationContentItem",
            "WFDCMapsLinkContentItem",
            "WFAVAssetContentItem",
            "WFPDFContentItem",
            "WFPhoneNumberContentItem",
            "WFRichTextContentItem",
            "WFSafariWebPageContentItem",
            "WFStringContentItem",
            "WFURLContentItem",
        ],
        "WFWorkflowTypes": ["WFWorkflowTypeShowInSearch"],
        "WFQuickActionSurfaces": [],
        "WFWorkflowImportQuestions": [],
        "WFWorkflowHasShortcutInputVariables": not manual,
    }


def build(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    specs = [
        ("Money Tracker - Notification Inbox", "line_notification", False),
        ("Money Tracker - Manual Screen Capture", "whats_on_screen", True),
    ]
    for name, capture_method, manual in specs:
        bare = out_dir / f"{name}.unsigned.shortcut"
        signed = out_dir / f"{name}.shortcut"
        workflow = make_workflow(name, capture_method, manual)
        bare.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY, sort_keys=False))
        # The Shortcuts CLI wraps the bare workflow in Apple's AEA1 archive.
        subprocess.run(
            ["shortcuts", "sign", "--mode", "people-who-know-me", "--input", str(bare), "--output", str(signed)],
            check=True,
        )
        bare.unlink(missing_ok=True)
        print(signed)


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("outputs/shortcuts")
    build(target)
