import type { ComposerFileIntake } from '../contract/slots.ts';
/**
 * Clipboard files in clipboard order, with members the entry API reports as directories.
 * @param transfer - clipboard payload of one paste event.
 * @returns the pasted files and their directory members; empty when the payload has no file item.
 */
export declare function clipboardFiles(transfer: DataTransfer): {
    files: File[];
    directories: Set<File>;
};
/**
 * Create the paste router shared by the composers of one plugin instance.
 * Its document listeners exist only while at least one composer is registered.
 * @returns the registration callback injected into each composer.
 */
export declare function createComposerFileIntake(): ComposerFileIntake;
//# sourceMappingURL=file-intake.d.ts.map