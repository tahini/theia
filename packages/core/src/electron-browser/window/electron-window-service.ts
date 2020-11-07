/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject } from 'inversify';
import { remote } from 'electron';
import { NewWindowOptions } from '../../browser/window/window-service';
import { DefaultWindowService } from '../../browser/window/default-window-service';
import { ElectronMainWindowService } from '../../electron-common/electron-main-window-service';

@injectable()
export class ElectronWindowService extends DefaultWindowService {

    @inject(ElectronMainWindowService)
    protected readonly delegate: ElectronMainWindowService;

    openNewWindow(url: string, { external }: NewWindowOptions = {}): undefined {
        this.delegate.openNewWindow(url, { external });
        return undefined;
    }

    registerUnloadListener(): void {
        // NOOP. The unload logic is handled in the `preventUnload` when running the app in electron env.
    }

    protected preventUnload(event: BeforeUnloadEvent): string | void {
        const electronWindow = remote.getCurrentWindow();
        const response = remote.dialog.showMessageBoxSync(electronWindow, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?',
            detail: 'Any unsaved changes will not be saved.'
        });
        if (response === 0) { // 'Yes', close the window.
            this.onUnloadEmitter.fire();
            delete event.returnValue; // Note: `delete` is crucial. `event.returnValue = undefined` does not work.
        } else {
            event.preventDefault();
            event.returnValue = true;
        }
    }

}
