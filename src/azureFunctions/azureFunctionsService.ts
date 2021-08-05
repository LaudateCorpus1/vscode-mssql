/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { BindingType, GetAzureFunctionsParams, GetAzureFunctionsRequest, InsertSqlBindingParams, InsertSqlBindingRequest } from '../models/contracts/azureFunctions/azureFunctionsRequest';
import vscode = require('vscode');
import path = require('path');
import * as fs from 'fs';
import * as glob from 'fast-glob';

export const hostFileName: string = 'host.json';

export class AzureFunctionsService {

    private _client: SqlToolsServiceClient;

    constructor(
        private _connectionManager: ConnectionManager
    ) {
        this._client = this._connectionManager.client;
    }

    public async getAzureFunctions(uri: vscode.Uri): Promise<string[]> {
        if (!uri) {
            return [];
        }

        console.error('in get azure functions');

        // get all the azure functions in the file
        const params: GetAzureFunctionsParams = {
            filePath: uri.fsPath
        };

        const result = await this._client.sendRequest(GetAzureFunctionsRequest.type, params);

        console.error('result is ' + JSON.stringify(result));

        if (result.success) {
            return result.azureFunctions;
        } else {
            throw new Error(result.errorMessage);
        }
    }

    public async insertSqlInputBinding(uri: vscode.Uri): Promise<void> {
        if (!uri) {
            // this command only shows in the command palette when the active editor is a .cs file, so we can safely assume that's the scenario
            // when this is called without a uri (right click on .cs file in file explorer to invoke this command)
            uri = vscode.window.activeTextEditor.document.uri;
        }

        console.error('trying to get functions project');
        const functionsProject = this.getFunctionsProject(uri);

        // input or output binding
        const intputOutputItems: vscode.QuickPickItem[] = [{ label: 'input' }, { label: 'output' }];

        const selectedBinding = (await vscode.window.showQuickPick(intputOutputItems, {
            canPickMany: false,
            title: 'Type of binding:'
        }))?.label;

        console.error('in insert sql input binding');

        // get all the azure functions in the file
        const azureFunctions = await this.getAzureFunctions(uri);
        console.error('Azure functions are ' + azureFunctions);

        if (azureFunctions.length === 0) {
            vscode.window.showErrorMessage('No Azure functions in the current file');
            return;
        }

        const items: vscode.QuickPickItem[] = [];

        for (const aFName of azureFunctions) {
            items.push({ label: aFName});
        }

        const azureFunctionName = (await vscode.window.showQuickPick(items, {
            canPickMany: false,
            title: 'Azure function in current file to add sql binding to:'
        }))?.label;

        if (!azureFunctionName) {
            return;
        }

        const objectName = await vscode.window.showInputBox({
            prompt: selectedBinding === 'input' ? 'Object to put in binding:' : 'Table to put in binding',
            value: '[dbo].[placeholder]',
            ignoreFocusOut: true
        });

        if (!objectName) {
            return;
        }

        // TODO: load local settings from local.settings.json like in LocalAppSettingListStep in vscode-azurefunctions repo
        const connectionStringSetting = await vscode.window.showInputBox({
            prompt: 'Connection string setting name',
            ignoreFocusOut: true
        });

        if (!connectionStringSetting) {
            return;
        }

        const params: InsertSqlBindingParams = {
            filePath: uri.fsPath,
            functionName: azureFunctionName,
            objectName: objectName,
            bindingType: selectedBinding === 'input' ? BindingType.input : BindingType.output,
            connectionStringSetting: connectionStringSetting
        };

        const result = await this._client.sendRequest(InsertSqlBindingRequest.type, params);

        // TODO - add nuget package
        // command: dotnet add generated-azfunctions/Pets.Namespace.csproj package Microsoft.Azure.WebJobs.Extensions.Sql -v 1.0.0-preview3
        console.error("result is " + JSON.stringify(result));

        if (!result.success) {
            vscode.window.showErrorMessage(result.errorMessage);
        }
    }

    // get project
    async getFunctionsProject(file: vscode.Uri): Promise<vscode.Uri | undefined> {
        const folder = vscode.workspace.getWorkspaceFolder(file);

        // look for azure functions csproj in the workspace
        // path needs to use forward slashes for glob to work
        const escapedPath = glob.escapePath(folder.uri.fsPath.replace(/\\/g, '/'));

        // can filter for multiple file extensions using folder/**/*.{sqlproj,csproj} format, but this notation doesn't work if there's only one extension
        // so the filter needs to be in the format folder/**/*.sqlproj if there's only one supported projectextension
        const projFilter = path.posix.join(escapedPath, '**', `*.csproj`);

        // glob will return an array of file paths with forward slashes, so they need to be converted back if on windows
        const projectFiles: vscode.Uri[] = (await glob(projFilter)).map(p => vscode.Uri.file(path.resolve(p)));

        // look for functions project if more than one project in the workspace folder
        if (projectFiles.length > 1) {
            console.error('more than one project. Will worry about this later...');
            for (const p of projectFiles) {
                console.error(p.fsPath);
                if (this.isFunctionProject(p.fsPath)) {
                    return p;
                }
            }

            return undefined;
        } else if (projectFiles.length === 0) {
            console.error('No Azure functions project');
            return undefined;
        } else {
            // verify the project is an Azure functions project
            console.error('checking project ' + projectFiles[0].fsPath);
            const isFuncProject = await this.isFunctionProject(path.dirname(projectFiles[0].fsPath));
            console.error('it isFuncProject is ' + isFuncProject);

            return projectFiles[0];
        }
    }

    // Use 'host.json' as an indicator that this is a functions project
    async isFunctionProject(folderPath: string): Promise<boolean> {
        return await this.fileExist(path.join(folderPath, hostFileName));
    }

    async fileExist(filePath: string): Promise<boolean> {
        const stats = await this.getFileStatus(filePath);
        return stats ? stats.isFile() : false;
    }

    async getFileStatus(filePath: string): Promise<fs.Stats | undefined> {
        try {
            const stats = await fs.promises.stat(filePath);
            return stats;
        } catch (e) {
            if (e.code === 'ENOENT') {
                return undefined;
            } else {
                throw e;
            }
        }
    }
}
