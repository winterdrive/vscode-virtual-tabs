/**
 * Regression test: the auto-reveal handler in extension.ts wrapped
 * TreeView.reveal() in a synchronous try/catch. reveal() returns a Thenable,
 * so when the target element had already disappeared from the tree (e.g. a
 * refresh landed between the debounce being scheduled and firing) the
 * rejection escaped as an unhandled promise rejection instead of being
 * logged. revealTreeItemSafely handles the rejection on the Thenable itself.
 */

import { revealTreeItemSafely } from '../../util';

jest.mock('vscode', () => ({}), { virtual: true });

describe('revealTreeItemSafely', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    test('forwards the item and options to reveal', async () => {
        const reveal = jest.fn().mockResolvedValue(undefined);
        const options = { select: true, focus: false, expand: false };

        await revealTreeItemSafely({ reveal }, 'item', options);

        expect(reveal).toHaveBeenCalledWith('item', options);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    test('async rejection from reveal is caught and logged, not rethrown', async () => {
        const failure = new Error('Data tree node not found');
        const reveal = jest.fn().mockRejectedValue(failure);

        await expect(revealTreeItemSafely({ reveal }, 'item')).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith('Tree reveal failed:', failure);
    });

    test('synchronous throw from reveal is caught and logged', async () => {
        const failure = new Error('disposed');
        const reveal = jest.fn(() => { throw failure; });

        await expect(revealTreeItemSafely({ reveal }, 'item')).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith('Tree reveal failed:', failure);
    });
});
