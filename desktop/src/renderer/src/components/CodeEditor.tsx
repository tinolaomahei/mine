import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// The explorer's editor (CodeMirror). Colours are mine's theme variables, so
// light, dark and any brand apply without anything here knowing about them.

const mix = 'color-mix(in oklch, var(--bloom-deep) 50%, var(--focus))'

const look = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'transparent', fontSize: '12.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--brand-font-mono)', lineHeight: '1.65' },
  '.cm-content': { caretColor: 'var(--bloom-deep)', paddingBlock: '10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--bloom-deep)', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'var(--paper-2)', color: 'var(--neutral)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { paddingInline: '14px 10px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--bloom-wash) 40%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--bloom-wash) 70%, transparent)', color: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--focus) 24%, transparent) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--focus) 14%, transparent)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in oklch, var(--bloom) 35%, transparent)', outline: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--paper-3)', border: 'none', color: 'var(--muted-ink)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--bloom) 30%, transparent)', outline: '1px solid var(--bloom)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--bloom) 55%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--brand-font-ui)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rule)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--rule)' },
  '.cm-panel input, .cm-panel button, .cm-textfield, .cm-button': {
    font: 'inherit',
    fontSize: '12px',
    color: 'var(--ink)',
    backgroundColor: 'var(--paper)',
    backgroundImage: 'none',
    border: '1px solid var(--rule)',
    borderRadius: '6px',
  },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--bloom-wash)', color: 'var(--ink)' },
})

const colours = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.tagName], color: 'var(--bloom-deep)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.url, t.inserted], color: 'var(--focus)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.deleted, t.escape], color: 'var(--signal)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--neutral)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.attributeName, t.propertyName, t.labelName], color: mix },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], fontWeight: '600' },
  { tag: [t.standard(t.variableName), t.self, t.special(t.variableName)], color: 'color-mix(in oklch, var(--focus) 60%, var(--ink))' },
  { tag: [t.meta, t.punctuation, t.processingInstruction], color: 'var(--muted-ink)' },
  { tag: t.heading, color: 'var(--bloom-deep)', fontWeight: '700' },
  { tag: [t.link], color: 'var(--focus)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, color: 'color-mix(in oklch, var(--focus) 60%, var(--ink))' },
  { tag: t.quote, color: 'var(--muted-ink)' },
  { tag: t.invalid, color: 'var(--signal)' },
])

export type EditorHandle = { view: EditorView; saved: Text }

/**
 * One editor, kept alive while its tab is open (so undo history and scroll
 * survive switching tabs). Reports whether it differs from what's saved.
 */
export function CodeEditor({
  path,
  initial,
  readOnly,
  hidden,
  onDirty,
  onSave,
  onReady,
}: {
  path: string
  initial: string
  readOnly?: boolean
  hidden?: boolean
  onDirty: (dirty: boolean) => void
  onSave: () => void
  onReady: (h: EditorHandle) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onDirty, onSave })
  cb.current = { onDirty, onSave }

  useEffect(() => {
    const language = new Compartment()
    const handle = {} as EditorHandle
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true) },
            indentWithTab,
          ]),
          language.of([]),
          look,
          syntaxHighlighting(colours),
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ 'aria-label': `Edit ${path.split(/[\\/]/).pop()}` }),
          // after every change: does it differ from what's saved? (the owner ignores repeats,
          // and moves `saved` along when it saves)
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onDirty(!u.state.doc.eq(handle.saved))
          }),
        ],
      }),
    })
    handle.view = view
    handle.saved = view.state.doc
    onReady(handle)

    // the language loads on demand, by file name
    const desc = LanguageDescription.matchFilename(languages, path.split(/[\\/]/).pop() ?? '')
    if (desc) void desc.load().then((support) => view.dispatch({ effects: language.reconfigure(support) }))

    return () => view.destroy()
    // one editor per tab: it never re-creates for the same file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" hidden={hidden} />
}
