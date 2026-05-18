#!/usr/bin/env python3
"""
Find dead/overridden CSS property declarations in style_v2.css.

A property is "dead" if a later rule wins over it:
1. !important beats non-!important
2. Higher specificity wins (same importance)
3. Later in file wins (same importance + specificity)
"""

import re
from collections import defaultdict

CSS_FILE = "/Users/bosskung/Document/Money Tracker/style_v2.css"

# Shorthands that override their longhands
SHORTHANDS = {
    "margin":       ["margin-top", "margin-right", "margin-bottom", "margin-left"],
    "padding":      ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    "border": [
        "border-top", "border-right", "border-bottom", "border-left",
        "border-width", "border-style", "border-color",
        "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
        "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
        "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    ],
    "border-top":    ["border-top-width", "border-top-style", "border-top-color"],
    "border-right":  ["border-right-width", "border-right-style", "border-right-color"],
    "border-bottom": ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
    "border-left":   ["border-left-width", "border-left-style", "border-left-color"],
    "background": [
        "background-color", "background-image", "background-position",
        "background-size", "background-repeat", "background-attachment",
        "background-origin", "background-clip",
    ],
    "font": [
        "font-style", "font-variant", "font-weight", "font-size",
        "line-height", "font-family",
    ],
    "flex":          ["flex-grow", "flex-shrink", "flex-basis"],
    "flex-flow":     ["flex-direction", "flex-wrap"],
    "animation": [
        "animation-name", "animation-duration", "animation-timing-function",
        "animation-delay", "animation-iteration-count", "animation-direction",
        "animation-fill-mode", "animation-play-state",
    ],
    "transition": [
        "transition-property", "transition-duration",
        "transition-timing-function", "transition-delay",
    ],
    "outline":       ["outline-width", "outline-style", "outline-color"],
    "overflow":      ["overflow-x", "overflow-y"],
    "inset":         ["top", "right", "bottom", "left"],
    "gap":           ["row-gap", "column-gap"],
    "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
    "grid-area":     ["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"],
    "list-style":    ["list-style-type", "list-style-position", "list-style-image"],
    "text-decoration": ["text-decoration-line", "text-decoration-color", "text-decoration-style"],
    "place-items":   ["align-items", "justify-items"],
    "place-content": ["align-content", "justify-content"],
}


def compute_specificity(selector):
    """Return (a, b, c) specificity tuple."""
    sel = selector.strip()
    sel = re.sub(r'"[^"]*"', '', sel)
    sel = re.sub(r"'[^']*'", '', sel)

    ids = len(re.findall(r'#[a-zA-Z_-][a-zA-Z0-9_-]*', sel))
    sel2 = re.sub(r'#[a-zA-Z_-][a-zA-Z0-9_-]*', '', sel)

    attrs = len(re.findall(r'\[[^\]]*\]', sel2))
    sel2 = re.sub(r'\[[^\]]*\]', '', sel2)

    classes = len(re.findall(r'\.[a-zA-Z_-][a-zA-Z0-9_-]*', sel2))
    sel2 = re.sub(r'\.[a-zA-Z_-][a-zA-Z0-9_-]*', '', sel2)

    pseudo_classes = len(re.findall(r'(?<!:):[a-zA-Z_-][a-zA-Z0-9_-]*(?:\([^)]*\))?', sel2))
    sel2 = re.sub(r'(?<!:):[a-zA-Z_-][a-zA-Z0-9_-]*(?:\([^)]*\))?', '', sel2)

    pseudo_elements = len(re.findall(r'::[a-zA-Z_-]+', sel2))
    sel2 = re.sub(r'::[a-zA-Z_-]+', '', sel2)

    types = len(re.findall(r'\b[a-zA-Z][a-zA-Z0-9-]*\b', sel2))

    b = classes + attrs + pseudo_classes
    c = types + pseudo_elements
    return (ids, b, c)


def is_at_rule(selector):
    """Return True if selector is an @-rule that wraps other rules."""
    sel = selector.strip()
    at_wrapping = ['@media', '@supports', '@keyframes', '@font-face', '@layer',
                   '@document', '@namespace', '@page']
    for at in at_wrapping:
        if sel.lower().startswith(at):
            return True
    return False


def is_skip_selector(selector):
    """Skip blocks we don't want to analyze for dead code."""
    sel = selector.strip()
    skip_patterns = [
        r'^@keyframes\b',
        r'^@font-face\b',
        r'^:root\b',
        r'^html\.dark\b',
        r'^@media\b',
        r'^@supports\b',
        r'^@charset\b',
        r'^@import\b',
        r'^@layer\b',
    ]
    for pat in skip_patterns:
        if re.match(pat, sel, re.IGNORECASE):
            return True
    return False


def remove_css_comments(text):
    """Replace CSS comments with spaces (preserving newlines for line count)."""
    result = []
    i = 0
    while i < len(text):
        if text[i:i+2] == '/*':
            end = text.find('*/', i + 2)
            if end == -1:
                # Unterminated — consume to end
                comment = text[i:]
                result.append(re.sub(r'[^\n]', ' ', comment))
                break
            comment = text[i:end + 2]
            result.append(re.sub(r'[^\n]', ' ', comment))
            i = end + 2
        else:
            result.append(text[i])
            i += 1
    return ''.join(result)


def tokenize_css(content):
    """
    Yield tokens: ('OPEN', selector, line), ('DECL', prop, value, important, line),
                  ('CLOSE', line)

    Handles:
    - Multi-selector rules (comma-separated)
    - Inline rules (selector { prop: val; } on one line)
    - Nested @rules
    - url() with parentheses
    - Missing trailing semicolons
    """
    n = len(content)
    pos = 0
    line = 1

    # Track line numbers
    def current_line():
        return line

    depth = 0
    selector_buf = []
    selector_start_line = 1
    in_string = False
    string_char = None
    in_paren = 0  # Track parentheses depth (for url(), calc(), etc.)

    # Declaration accumulator (inside a rule block)
    decl_buf = []
    decl_start_line = 1
    current_selectors = []   # list of (selector_str, line)
    current_depth_selectors = {}  # depth -> selector info
    current_skip = [False]

    tokens = []

    while pos < n:
        ch = content[pos]

        # Track line numbers
        if ch == '\n':
            line += 1
            pos += 1
            if depth == 0:
                selector_buf.append('\n')
            else:
                decl_buf.append('\n')
            continue

        # Handle string literals
        if in_string:
            if ch == string_char and (pos == 0 or content[pos-1] != '\\'):
                in_string = False
            if depth > 0:
                decl_buf.append(ch)
            else:
                selector_buf.append(ch)
            pos += 1
            continue

        if ch in ('"', "'"):
            in_string = True
            string_char = ch
            if depth > 0:
                decl_buf.append(ch)
            else:
                selector_buf.append(ch)
            pos += 1
            continue

        # Handle url( and other function parentheses
        if depth > 0:
            if ch == '(' :
                in_paren += 1
                decl_buf.append(ch)
                pos += 1
                continue
            if ch == ')' and in_paren > 0:
                in_paren -= 1
                decl_buf.append(ch)
                pos += 1
                continue

        # Opening brace
        if ch == '{' and in_paren == 0:
            if depth == 0:
                sel = ''.join(selector_buf).strip()
                selector_buf = []
                sel_line = selector_start_line
                selector_start_line = line + 1

                skip = is_skip_selector(sel)
                # Inherit skip from outer context
                parent_skip = current_skip[-1] if current_skip else False
                effective_skip = skip or parent_skip

                current_skip.append(effective_skip)
                depth += 1

                if not effective_skip:
                    # Handle comma-separated selectors
                    parts = [s.strip() for s in sel.split(',') if s.strip()]
                    for part in parts:
                        tokens.append(('OPEN', part, sel_line))
                else:
                    tokens.append(('OPEN_SKIP', sel, sel_line))

                decl_buf = []
                decl_start_line = line + 1
            else:
                # Nested block (e.g., @media inside another rule — unusual but possible)
                sel = ''.join(decl_buf).strip()
                decl_buf = []
                skip = is_skip_selector(sel) or current_skip[-1]
                current_skip.append(skip)
                depth += 1
                if not skip:
                    parts = [s.strip() for s in sel.split(',') if s.strip()]
                    for part in parts:
                        tokens.append(('OPEN', part, line))
                else:
                    tokens.append(('OPEN_SKIP', sel, line))

            pos += 1
            continue

        # Closing brace
        if ch == '}' and in_paren == 0:
            if depth > 0:
                # Flush any remaining declaration in buffer (no trailing semicolon)
                decl_text = ''.join(decl_buf).strip()
                decl_buf = []
                if decl_text and ':' in decl_text and not current_skip[-1]:
                    # Try to parse as declaration
                    colon = decl_text.index(':')
                    prop = decl_text[:colon].strip().lower()
                    val = decl_text[colon+1:].strip()
                    if re.match(r'^-?-?[a-zA-Z][a-zA-Z0-9_-]*$', prop) and not prop.startswith('--'):
                        imp = '!important' in val.lower()
                        if imp:
                            val = re.sub(r'\s*!important\s*', '', val, flags=re.IGNORECASE).strip()
                        tokens.append(('DECL', prop, val, imp, decl_start_line))

                if not current_skip[-1]:
                    tokens.append(('CLOSE', line))
                else:
                    tokens.append(('CLOSE_SKIP', line))

                current_skip.pop()
                depth -= 1
                selector_start_line = line + 1

            pos += 1
            continue

        # Semicolon — end of declaration
        if ch == ';' and depth > 0:
            decl_text = ''.join(decl_buf).strip()
            decl_buf = []
            next_start = line

            if decl_text and ':' in decl_text and not current_skip[-1]:
                colon = decl_text.index(':')
                prop = decl_text[:colon].strip().lower()
                val = decl_text[colon+1:].strip()
                # Clean up internal whitespace/newlines in value
                val = re.sub(r'\s+', ' ', val).strip()
                if re.match(r'^-?-?[a-zA-Z][a-zA-Z0-9_-]*$', prop) and not prop.startswith('--'):
                    imp = '!important' in val.lower()
                    if imp:
                        val = re.sub(r'\s*!important\s*', '', val, flags=re.IGNORECASE).strip()
                    tokens.append(('DECL', prop, val, imp, decl_start_line))

            decl_start_line = next_start + 1
            pos += 1
            continue

        # Regular character
        if depth == 0:
            selector_buf.append(ch)
        else:
            if not decl_buf:
                decl_start_line = line
            decl_buf.append(ch)
        pos += 1

    return tokens


def parse_css(filepath):
    """Parse CSS and return list of declarations grouped by rule."""
    with open(filepath, 'r', encoding='utf-8') as f:
        raw = f.read()

    content = remove_css_comments(raw)
    tokens = tokenize_css(content)

    declarations = []

    # Walk tokens: maintain current open selectors
    open_selectors = []  # stack of selectors

    for tok in tokens:
        kind = tok[0]

        if kind == 'OPEN':
            _, sel, sel_line = tok
            open_selectors.append((sel, sel_line))

        elif kind == 'CLOSE':
            if open_selectors:
                open_selectors.pop()

        elif kind in ('OPEN_SKIP', 'CLOSE_SKIP'):
            pass  # Skip blocks tracked separately

        elif kind == 'DECL':
            _, prop, val, imp, decl_line = tok
            if open_selectors:
                # Use the innermost selector
                selector, rule_start = open_selectors[-1]
                declarations.append({
                    'selector': selector,
                    'property': prop,
                    'value': val,
                    'important': imp,
                    'line': decl_line,
                    'rule_start': rule_start,
                    'specificity': compute_specificity(selector),
                })

    return declarations


def wins_over(d2, d1):
    """Return True if d2 (later) overrides d1 (earlier)."""
    if d2['important'] and not d1['important']:
        return True
    if d1['important'] and not d2['important']:
        return False
    # Same importance: later with >= specificity wins
    return d2['specificity'] >= d1['specificity']


def last_compound_selector(sel):
    """Get the last compound selector (after combinators)."""
    parts = re.split(r'[\s>+~]+', sel.strip())
    return parts[-1] if parts else sel


def find_dead_properties(declarations):
    """
    Find declarations overridden by later ones.
    Returns list of (dead_decl, winning_decl) tuples.
    """
    dead = []
    seen_dead = set()

    # Group by selector
    by_selector = defaultdict(list)
    for d in declarations:
        by_selector[d['selector']].append(d)

    # Pattern 1: Same selector, same property — later always wins
    for selector, decl_list in by_selector.items():
        by_prop = defaultdict(list)
        for d in decl_list:
            by_prop[d['property']].append(d)

        for prop, prop_decls in by_prop.items():
            for i, d in enumerate(prop_decls):
                key = (d['selector'], d['property'], d['line'])
                if key in seen_dead:
                    continue
                for d2 in prop_decls[i + 1:]:
                    if wins_over(d2, d):
                        dead.append((d, d2))
                        seen_dead.add(key)
                        break

        # Pattern 2: Shorthand overrides longhand (same selector)
        for shorthand, longhands in SHORTHANDS.items():
            sh_decls = by_prop.get(shorthand, [])
            if not sh_decls:
                continue
            for lh in longhands:
                lh_decls = by_prop.get(lh, [])
                for lh_d in lh_decls:
                    key = (lh_d['selector'], lh_d['property'], lh_d['line'])
                    if key in seen_dead:
                        continue
                    for sh_d in sh_decls:
                        if sh_d['line'] > lh_d['line'] and wins_over(sh_d, lh_d):
                            dead.append((lh_d, sh_d))
                            seen_dead.add(key)
                            break

    # Pattern 3: !important cross-selector override (conservative)
    # Build property -> all declarations index
    by_prop_all = defaultdict(list)
    for d in declarations:
        by_prop_all[d['property']].append(d)

    for prop, all_decls in by_prop_all.items():
        for i, d in enumerate(all_decls):
            key = (d['selector'], d['property'], d['line'])
            if key in seen_dead:
                continue
            core1 = last_compound_selector(d['selector'])
            for d2 in all_decls[i + 1:]:
                if d2['selector'] == d['selector']:
                    continue  # Already in pattern 1
                if not (d2['important'] and not d['important']):
                    continue
                # Conservative: same last compound selector
                core2 = last_compound_selector(d2['selector'])
                if core1 and core2 and core1 == core2:
                    dead.append((d, d2))
                    seen_dead.add(key)
                    break

    # Pattern 4: !important shorthand cross-selector
    for shorthand, longhands in SHORTHANDS.items():
        sh_all = by_prop_all.get(shorthand, [])
        for lh in longhands:
            for lh_d in by_prop_all.get(lh, []):
                key = (lh_d['selector'], lh_d['property'], lh_d['line'])
                if key in seen_dead:
                    continue
                core1 = last_compound_selector(lh_d['selector'])
                for sh_d in sh_all:
                    if sh_d['selector'] == lh_d['selector']:
                        continue
                    if sh_d['line'] <= lh_d['line']:
                        continue
                    if not (sh_d['important'] and not lh_d['important']):
                        continue
                    core2 = last_compound_selector(sh_d['selector'])
                    if core1 and core2 and core1 == core2:
                        dead.append((lh_d, sh_d))
                        seen_dead.add(key)
                        break

    return dead


def format_report(dead_list):
    if not dead_list:
        print("No dead properties found.")
        return

    by_selector = defaultdict(list)
    for d, d2 in dead_list:
        by_selector[d['selector']].append((d, d2))

    selector_order = sorted(
        by_selector.keys(),
        key=lambda s: min(d['line'] for d, _ in by_selector[s])
    )

    print("DEAD PROPERTIES FOUND:")
    print("======================")
    print()

    total = 0
    for selector in selector_order:
        entries = sorted(by_selector[selector], key=lambda x: x[0]['line'])
        print(f"Selector: {selector}")
        for d, d2 in entries:
            imp  = " !important" if d['important']  else ""
            imp2 = " !important" if d2['important'] else ""
            val  = d['value'][:57]  + ("..." if len(d['value'])  > 60 else "")
            val2 = d2['value'][:57] + ("..." if len(d2['value']) > 60 else "")
            sel2 = d2['selector'][:50] + ("..." if len(d2['selector']) > 50 else "")
            print(f"  Line {d['line']:4d}: {d['property']}: {val}{imp}")
            print(f"    → Overridden by: line {d2['line']} {sel2} {{ {d2['property']}: {val2}{imp2} }}")
            total += 1
        print()

    print("======================")
    print(f"Total dead property declarations: {total}")


def main():
    print(f"Parsing {CSS_FILE}...")
    declarations = parse_css(CSS_FILE)
    print(f"Found {len(declarations)} declarations (excluding @keyframes/@font-face/:root/html.dark/@media/@supports)")
    print()

    print("Finding overridden declarations...")
    dead_list = find_dead_properties(declarations)
    print()

    format_report(dead_list)


if __name__ == '__main__':
    main()
