"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Schema, type DOMOutputSpec, type NodeSpec, type Node as DocNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import "prosemirror-view/style/prosemirror.css";
import { briefKeys, buyerKeys, isMultiline, labels, productKeys, requiredKeys, type Brief, type BriefKey } from "@/lib/profile-brief";
import styles from "./profile-brief-editor.module.css";

function group(title: string, keys: BriefKey[]): NodeSpec {
  return {
    content: keys.join(" "), isolating: true,
    parseDOM: [{ tag: `section[data-brief-group="${keys[0]}"]`, contentElement: "div" }],
    toDOM: () => ["section", { "data-brief-group": keys[0] }, ["h3", { contenteditable: "false" }, title], ["div", 0]],
  };
}

function field(key: BriefKey): NodeSpec {
  const required = requiredKeys.has(key);
  const label: DOMOutputSpec = ["span", { id: `brief-label-${key}`, class: styles.label, "data-brief-label": key, contenteditable: "false" },
    labels[key], ...(required ? [["span", { class: "text-destructive", "aria-hidden": "true" }, " *"] as DOMOutputSpec] : [])];
  return {
    content: "text*", code: true, isolating: true,
    parseDOM: [{ tag: `div[data-field="${key}"]`, contentElement: "[data-brief-value]", preserveWhitespace: "full" }],
    toDOM: () => ["div", { class: styles.row, "data-field": key }, label,
      ["div", { class: styles.value, "data-brief-value": "", "aria-labelledby": `brief-label-${key}` }, 0]],
  };
}

// Fixed document nodes keep field boundaries intact through typing, paste and undo.
// Labels are editor chrome and never enter the saved product or ICP.
const schema = new Schema({ nodes: {
  doc: { content: "product buyers" }, product: group("Product", productKeys),
  buyers: group("Target buyers", buyerKeys),
  ...Object.fromEntries(briefKeys.map((key) => [key, field(key)])), text: {},
} });

function documentFor(brief: Brief) {
  const section = (name: string, keys: BriefKey[]) => schema.node(name, null, keys.map((key) =>
    schema.node(key, null, brief[key] ? schema.text(brief[key]) : undefined)));
  return schema.node("doc", null, [section("product", productKeys), section("buyers", buyerKeys)]);
}

function readBrief(doc: DocNode): Brief {
  const values = {} as Brief;
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    values[node.type.name as BriefKey] = node.textContent;
    return false;
  });
  return values;
}

export function focusBriefField(view: EditorView | null, key: BriefKey) {
  if (!view) return;
  let start = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === key) start = pos + 1;
    return !node.isTextblock;
  });
  if (start) {
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start)).scrollIntoView());
  }
}

export function ProfileBriefEditor({ value, onChange, editorRef, disabled, invalid }: {
  value: Brief; onChange: (value: Brief) => void; editorRef: RefObject<EditorView | null>;
  disabled: boolean; invalid: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onChange, disabled, invalid });
  useLayoutEffect(() => { latest.current = { value, onChange, disabled, invalid }; });

  useEffect(() => {
    const state = EditorState.create({
      doc: documentFor(latest.current.value), plugins: [
        history(), keymap({
          "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo,
          Enter: (state, dispatch, view) => {
            const key = state.selection.$from.parent.type.name as BriefKey;
            if (isMultiline(key)) {
              dispatch?.(state.tr.insertText("\n").scrollIntoView());
            } else if (view) {
              const next = briefKeys[briefKeys.indexOf(key) + 1];
              if (next) focusBriefField(view, next);
            }
            return true;
          },
        }), keymap(baseKeymap),
      ],
    });
    const view = new EditorView(host.current, {
      state,
      scrollThreshold: { top: 116, bottom: 32, left: 0, right: 0 },
      scrollMargin: { top: 128, bottom: 40, left: 0, right: 0 },
      decorations(state) {
        const cursor = state.selection.$from;
        if (!cursor.parent.isTextblock) return null;
        return DecorationSet.create(state.doc, [Decoration.node(cursor.before(), cursor.after(), { "data-current": "" })]);
      },
      attributes: () => ({
        role: "textbox", "aria-labelledby": "brief-label", "aria-multiline": "true", "aria-required": "true",
        "aria-invalid": String(latest.current.invalid), "aria-readonly": String(latest.current.disabled),
        ...(latest.current.invalid ? { "aria-describedby": "brief-error" } : {}),
      }),
      editable: () => !latest.current.disabled,
      handleDOMEvents: {
        mousedown(view, event) {
          const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-brief-label]") : null;
          if (!target || latest.current.disabled) return false;
          event.preventDefault();
          focusBriefField(view, target.dataset.briefLabel as BriefKey);
          return true;
        },
      },
      handlePaste(view, event) {
        if (!event.clipboardData || event.clipboardData.getData("text/html").includes("data-pm-slice=")) return false;
        const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
        view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        return true;
      },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) latest.current.onChange(readBrief(view.state.doc));
      },
    });
    editorRef.current = view;
    return () => { editorRef.current = null; view.destroy(); };
  }, [editorRef]);

  useLayoutEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const next = documentFor(value);
    // Only externally applied suggestions and server revisions need a document update.
    if (!view.state.doc.eq(next)) {
      view.updateState(EditorState.create({ doc: next, plugins: view.state.plugins }));
    } else {
      view.updateState(view.state);
    }
  }, [value, disabled, invalid, editorRef]);

  return <div className={styles.editor} ref={host} />;
}
