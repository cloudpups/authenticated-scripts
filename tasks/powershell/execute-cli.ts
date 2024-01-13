import fs = require('fs');
import path = require('path');
import os = require('os');
import tl = require('azure-pipelines-task-lib/task');
import tr = require('azure-pipelines-task-lib/toolrunner');
import uuidV4 = require('uuid/v4');

function getServiceConnection() {
    const serviceConnectionId = tl.getInput("serviceConnection", true);
    const url = tl.getEndpointUrl(serviceConnectionId, true);
    const username = tl.getEndpointAuthorizationParameter(serviceConnectionId, "username", true);
    const password = tl.getEndpointAuthorizationParameter(serviceConnectionId, "password", false);

    return {
        url: url,
        username: username,
        password: password
    }
}

async function run() {
    try {
        tl.setResourcePath(path.join(__dirname, 'task.json'));

        // Get inputs.
        const input_errorActionPreference: string = tl.getInput('errorActionPreference', false) || 'Stop';
        switch (input_errorActionPreference.toUpperCase()) {
            case 'STOP':
            case 'CONTINUE':
            case 'SILENTLYCONTINUE':
                break;
            default:
                throw new Error(tl.loc('JS_InvalidErrorActionPreference', input_errorActionPreference));
        }
        const input_showWarnings = tl.getBoolInput('showWarnings', false);
        const input_failOnStderr = tl.getBoolInput('failOnStderr', false);
        const input_ignoreLASTEXITCODE = tl.getBoolInput('ignoreLASTEXITCODE', false);
        const input_workingDirectory = tl.getPathInput('workingDirectory', /*required*/ true, /*check*/ true);
        const input_pwsh: boolean = tl.getBoolInput('pwsh', false);
        
        let input_filePath: string;
        let input_arguments: string;
        let input_script: string;
        const input_targetType: string = tl.getInput('targetType') || '';
        
        if (input_targetType.toUpperCase() == 'FILEPATH') {
            input_filePath = tl.getPathInput('filePath', /*required*/ true);
            if (!tl.stats(input_filePath).isFile() || !input_filePath.toUpperCase().match(/\.PS1$/)) {
                throw new Error(tl.loc('JS_InvalidFilePath', input_filePath));
            }

            input_arguments = tl.getInput('arguments') || '';
        }
        else if (input_targetType.toUpperCase() == 'INLINE') {
            input_script = tl.getInput('script', false) || '';
        }
        else {
            throw new Error(tl.loc('JS_InvalidTargetType', input_targetType));
        }
        const input_runScriptInSeparateScope = tl.getBoolInput('runScriptInSeparateScope');

        // Generate the script contents.
        console.log(tl.loc('GeneratingScript'));
        const contents: string[] = [];
        contents.push(`$ErrorActionPreference = '${input_errorActionPreference}'`);
        let script = '';
        if (input_targetType.toUpperCase() == 'FILEPATH') {
            script = `. '${input_filePath.replace(/'/g, "''")}' ${input_arguments}`.trim();
        } else {
            script = `${input_script}`;
        }
        if (input_showWarnings) {
            script = `
                $warnings = New-Object System.Collections.ObjectModel.ObservableCollection[System.Management.Automation.WarningRecord];
                Register-ObjectEvent -InputObject $warnings -EventName CollectionChanged -Action {
                    if($Event.SourceEventArgs.Action -like "Add"){
                        $Event.SourceEventArgs.NewItems | ForEach-Object {
                            Write-Host "##vso[task.logissue type=warning;]$_";
                        }
                    }
                };
                Invoke-Command {${script}} -WarningVariable +warnings;
            `;
        }
        contents.push(script);
        // log with detail to avoid a warning output.
        tl.logDetail(uuidV4(), tl.loc('JS_FormattedCommand', script), null, 'command', 'command', 0);

        if (!input_ignoreLASTEXITCODE) {
            contents.push(`if (!(Test-Path -LiteralPath variable:\LASTEXITCODE)) {`);
            contents.push(`    Write-Host '##vso[task.debug]$LASTEXITCODE is not set.'`);
            contents.push(`} else {`);
            contents.push(`    Write-Host ('##vso[task.debug]$LASTEXITCODE: {0}' -f $LASTEXITCODE)`);
            contents.push(`    exit $LASTEXITCODE`);
            contents.push(`}`);
        }

        // Write the script to disk.
        tl.assertAgent('2.115.0');
        const tempDirectory = tl.getVariable('agent.tempDirectory');
        tl.checkPath(tempDirectory, `${tempDirectory} (agent.tempDirectory)`);
        const filePath = path.join(tempDirectory, uuidV4() + '.ps1');
        fs.writeFileSync(
            filePath,
            '\ufeff' + contents.join(os.EOL), // Prepend the Unicode BOM character.
            { encoding: 'utf8' });            // Since UTF8 encoding is specified, node will
        //                                    // encode the BOM into its UTF8 binary sequence.

        // Run the script.
        //
        // Note, prefer "powershell" over "pwsh" on Windows unless the pwsh input is true.
        //
        // Note, use "-Command" instead of "-File" to match the Windows implementation. Refer to
        // comment on Windows implementation for an explanation why "-Command" is preferred.
        console.log('========================== Starting Command Output ===========================');

        const executionOperator = input_runScriptInSeparateScope ? '&' : '.';
        const isWindows = os.platform() === 'win32';
                
        let powershell: tr.ToolRunner;
        if (input_pwsh || !isWindows) {
            powershell = tl.tool(tl.which('pwsh') || tl.which('powershell') || tl.which('pwsh', true));
        } else {
            powershell = tl.tool(tl.which('powershell') || tl.which('pwsh') || tl.which('powershell', true));
        }

        powershell.arg('-NoLogo')
            .arg('-NoProfile')
            .arg('-NonInteractive')
            .arg('-Command')
            .arg(`${executionOperator} '${filePath.replace(/'/g, "''")}'`);

        const serviceConnection = getServiceConnection();        
        const serviceConnectionAsEnv = {
            "AS_SC_URL": serviceConnection.url,
            "AS_SC_USERNAME": serviceConnection.username,
            "AS_SC_PASSWORD": serviceConnection.password
        };

        // We do not want to overwrite the existing environment variables.
        const mergedEnvironment = { 
            ...process.env,
            ...serviceConnectionAsEnv
        }

        const options = <tr.IExecOptions>{
            cwd: input_workingDirectory,
            failOnStdErr: false,
            errStream: process.stdout, // Direct all output to STDOUT, otherwise the output may appear out
            outStream: process.stdout, // of order since Node buffers it's own STDOUT but not STDERR.
            ignoreReturnCode: true,
            env: mergedEnvironment
        };

        // Listen for stderr.
        let stderrFailure = false;
        const aggregatedStderr: string[] = [];
        if (input_failOnStderr) {
            powershell.on('stderr', (data: Buffer) => {
                stderrFailure = true;
                aggregatedStderr.push(data.toString('utf8'));
            });
        }

        // Run bash.
        let exitCode: number = await powershell.exec(options);
        // Fail on exit code.
        if (exitCode !== 0) {
            tl.setResult(tl.TaskResult.Failed, tl.loc('JS_ExitCode', exitCode));
        }

        // Fail on stderr.
        if (stderrFailure) {
            tl.setResult(tl.TaskResult.Failed, tl.loc('JS_Stderr'));
            aggregatedStderr.forEach((err: string) => {
                tl.error(err);
            });
        }
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message || 'run() failed');
    }
}

run();