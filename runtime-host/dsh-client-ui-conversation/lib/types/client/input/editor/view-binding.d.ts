/** DOM and keymap bindings installed by the InputBar's existing effects. */
import type { MouseEvent, MutableRefObject, RefObject } from 'react';
import type { LexicalEditor } from 'lexical';
import type { ComposerKeyboard } from '../../contract/draft-editor.ts';
import type { BusyEnterBehavior } from '../../contract/composer-submission.ts';
/**
 * Transfer mobile editor focus after a submission empties the draft.
 * A control the user already focused retains focus.
 * @param editor - the Session-owned editor.
 * @param destination - stable, focusable non-text element that retains the composer's keyboard position.
 * @returns the update-listener cleanup.
 */
export declare function installDraftKeyboardDismissal(editor: LexicalEditor, destination: RefObject<HTMLElement>): () => void;
interface DraftViewGate {
    locked: boolean;
    machineBusy: boolean;
    canSteerQueue: boolean;
    running: boolean;
    steeringAvailable: boolean;
    busyEnter: BusyEnterBehavior;
    intakeFiles: (files: readonly File[], directories?: ReadonlySet<File>) => void;
    uploadsPending: boolean;
    /** Toast text explaining why pending uploads hold the send. */
    uploadsHeldText: string;
    showToast: (text: string) => void;
    canAcceptDrop: boolean;
}
/**
 * Reveal the DOM selection within the draft's own scrollport.
 * @param scrollRef - the InputBar-owned scrollport reference.
 */
export declare function revealDraftSelection(scrollRef: RefObject<HTMLDivElement>): void;
/**
 * Focus the borrowed editor and reveal its restored selection.
 * @param editor - the Session-owned editor.
 * @param revealSelection - reveal the selection after Lexical restores it.
 */
export declare function focusDraftEditor(editor: LexicalEditor, revealSelection: () => void): void;
/**
 * Forward wheel movement at the draft's edge to its conversation scrollport.
 * @param scrollRef - the InputBar-owned scrollport reference.
 * @returns the listener cleanup, or undefined when the element is absent.
 */
export declare function installDraftWheel(scrollRef: RefObject<HTMLDivElement>): (() => void) | undefined;
/**
 * Bind this view's file dialog through the existing keyboard face.
 * @param keyboard - the Session-owned composer operations.
 * @param gate - live intake availability retained by InputBar.
 * @param fileInputRef - the view's native file input.
 * @returns the picker unbind disposer.
 */
export declare function installDraftFilePicker(keyboard: ComposerKeyboard, gate: MutableRefObject<Pick<DraftViewGate, 'canAcceptDrop'>>, fileInputRef: RefObject<HTMLInputElement>): () => void;
/**
 * Bind editor gestures to the view's live guards and Session operations.
 * @param editor - the borrowed Session-owned editor.
 * @param keyboard - the existing composer keyboard operations.
 * @param gate - live view values read by the installed handlers.
 * @returns the keymap disposer.
 */
export declare function installDraftKeymap(editor: LexicalEditor, keyboard: ComposerKeyboard, gate: MutableRefObject<DraftViewGate>): () => void;
/**
 * Keep a toolbar press from moving focus away from the draft.
 * @param event - the toolbar button's mouse event.
 * @param editor - the borrowed editor, absent in the inert view.
 */
export declare function keepDraftFocus(event: MouseEvent<HTMLButtonElement>, editor: LexicalEditor | null): void;
export {};
//# sourceMappingURL=view-binding.d.ts.map