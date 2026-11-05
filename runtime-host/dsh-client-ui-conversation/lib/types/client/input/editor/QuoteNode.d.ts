/** Atomic composer quote node and whole-node removal command. */
import type { JSX } from 'react';
import type { EditorConfig, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { DecoratorNode } from 'lexical';
/** Localized non-persisted labels applied by the owning input shell. */
export interface QuoteNodeLabels {
    readonly remove: string;
}
/** JSON form used only by Lexical's editor-state APIs, not browser persistence. */
export type SerializedQuoteNode = Spread<{
    text: string;
}, SerializedLexicalNode>;
/** Remove one quote occurrence by its Lexical identity. */
export declare const REMOVE_QUOTE_COMMAND: import("lexical").LexicalCommand<string>;
/** Pure React face of one quote node. */
export declare function QuoteNodeView({ editor, nodeKey, text, labels }: {
    readonly editor: LexicalEditor;
    readonly nodeKey: NodeKey;
    readonly text: string;
    readonly labels: QuoteNodeLabels;
}): JSX.Element;
/** One selected transcript range represented as an atomic inline decorator. */
export declare class QuoteNode extends DecoratorNode<JSX.Element> {
    __text: string;
    __labels: QuoteNodeLabels;
    /** Lexical node registry type tag. */
    static getType(): string;
    /** @param node - node to clone. @returns a copy carrying the same NodeKey. */
    static clone(node: QuoteNode): QuoteNode;
    /** @param json - serialized editor node. @returns a fresh node with default runtime labels. */
    static importJSON(json: SerializedQuoteNode): QuoteNode;
    /**
     * @param text - selected text.
     * @param labels - runtime-only localized labels.
     * @param key - Lexical clone-path key; absent for fresh nodes.
     */
    constructor(text: string, labels?: QuoteNodeLabels, key?: NodeKey);
    /** Serialize the quote data without its runtime presentation state. */
    exportJSON(): SerializedQuoteNode;
    /** Mount one non-editable inline host. */
    createDOM(_config: EditorConfig): HTMLElement;
    /** Updates reuse the existing host element. */
    updateDOM(): boolean;
    /** Quotes flow with draft text and wrap at their own text boundary. */
    isInline(): boolean;
    /** Arrow movement crosses the quote without entering a NodeSelection. */
    isKeyboardSelectable(): boolean;
    /** Clipboard text is the exact model-visible Markdown blockquote. */
    getTextContent(): string;
    /** Selected visible quote text. */
    getQuoteText(): string;
    /** Update the localized remove label without changing persisted quote data. */
    setLabels(labels: QuoteNodeLabels): void;
    /** Render the quote body and its independent close control. */
    decorate(editor: LexicalEditor): JSX.Element;
}
/** @param text - selected quote text. @param labels - runtime labels. @returns a fresh node. */
export declare function $createQuoteNode(text: string, labels: QuoteNodeLabels): QuoteNode;
/** @param node - possible Lexical node. @returns whether it is a QuoteNode. */
export declare function $isQuoteNode(node: LexicalNode | null | undefined): node is QuoteNode;
//# sourceMappingURL=QuoteNode.d.ts.map