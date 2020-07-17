import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';
import * as lsp from 'vscode-languageclient';

let extensionPath: string;

const workspace = vscode.workspace;
const workspaceClients: Map<vscode.WorkspaceFolder, lsp.LanguageClient> = new Map();

interface AppConfig {
	modulesPath: string | null,
	stdlibPath: string | null,
	compilerDir: string,
	network: string,
	sender: string | undefined | null
}

interface MlsConfig {
	dialect: string,
	modules_folders: string[],
	stdlib_folder: string | undefined | null,
	sender_address: string | undefined | null
}

/**
 * Activate extension: register commands, attach handlers
 * @param {vscode.ExtensionContext} context
 */
export async function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('move.compile', () => compileCommand().catch(console.error)));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('move.dry-run', (textEditor, edit) => executeMoveFileCommand(textEditor, edit, true).catch(console.error)));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('move.run', (textEditor, edit) => executeMoveFileCommand(textEditor, edit, false).catch(console.error)));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('move.deploy', (textEditor, edit) => executeMoveFileCommand(textEditor, edit, false, true).catch(console.error)));

	extensionPath = context.extensionPath;
	const outputChannel = vscode.window.createOutputChannel('move-language-server');

	function didOpenTextDocument(document: vscode.TextDocument) {

		if (!checkDocumentLanguage(document, 'move')) {
			return;
		}

		const folder = workspace.getWorkspaceFolder(document.uri);

		if (folder === undefined || workspaceClients.has(folder)) {
			console.log('LANGUAGE SERVER ALREADY STARTED');
			return;
		}

		const executable = (process.platform === 'win32') ? 'move-ls.exe' : 'move-ls';
		const cfgBinPath = workspace.getConfiguration('move', document.uri).get<string>('languageServerPath');
		let binaryPath = cfgBinPath || path.join(extensionPath, 'bin', executable);

		const lspExecutable: lsp.Executable = {
			command: binaryPath,
			options: { env: { RUST_LOG: 'info' } },
		};

		const serverOptions: lsp.ServerOptions = {
			run: lspExecutable,
			debug: lspExecutable,
		};

		const config = loadConfig(document);
		const clientOptions: lsp.LanguageClientOptions = {
			outputChannel,
			workspaceFolder: folder,
			documentSelector: [{ scheme: 'file', language: 'move', pattern: folder.uri.fsPath + '/**/*' }],
			initializationOptions: configToLsOptions(config)
		};

		const client = new lsp.LanguageClient('move-language-server', 'Move Language Server', serverOptions, clientOptions);

		client.start();

		workspaceClients.set(folder, client);
	}

	workspace.onDidOpenTextDocument(didOpenTextDocument);
	workspace.textDocuments.forEach(didOpenTextDocument);
	workspace.onDidChangeWorkspaceFolders((event) => {
		for (const folder of event.removed) {
			const client = workspaceClients.get(folder);
			if (client) {
				workspaceClients.delete(folder);
				client.stop();
			}
		}
	});

	// subscribe to .mvconfig.json changes
	workspace.onDidSaveTextDocument(function onDidSaveConfiguration(document: vscode.TextDocument) {

		if (!checkDocumentLanguage(document, 'json')) {
			return;
		}

		const config = workspace.getConfiguration('move', document.uri);
		const file = config.get<string>('configPath') || '.mvconfig.json';

		if (!document.fileName.includes(file)) {
			return;
		}

		try {
			JSON.parse(document.getText()); // check if file is valid JSON
		} catch (e) {
			return;
		}

		const folder = workspace.getWorkspaceFolder(document.uri);
		// @ts-ignore
		const client = workspaceClients.get(folder);

		if (!client || client.constructor !== lsp.LanguageClient) {
			return;
		}

		const finConfig = loadConfig(document);
		client.sendNotification('workspace/didChangeConfiguration', { settings: "" });
		client.onRequest('workspace/configuration', () => configToLsOptions(finConfig));
	});
}

// this method is called when your extension is deactivated
export function deactivate() {
	return Array.from(workspaceClients.entries())
		.map(([, client]) => client.stop())
		.reduce((chain, prom) => chain.then(() => prom), Promise.resolve());
}


function configToLsOptions(cfg: AppConfig): MlsConfig {
	const modules_folders = [];

	if (cfg.modulesPath) {
		modules_folders.push(cfg.modulesPath);
	}

	return {
		modules_folders,
		dialect: cfg.network || 'libra',
		stdlib_folder: cfg.stdlibPath,
		sender_address: cfg.sender,
	};
}

function checkDocumentLanguage(document: vscode.TextDocument, languageId: string) {
	if (document.languageId !== languageId || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
		return false;
	}

	return true;
}

async function executeMoveFileCommand(
	textEditor: vscode.TextEditor,
	_edit: vscode.TextEditorEdit,
	dryRun: boolean,
	isDeploy: boolean = false
) {
	let doc = textEditor.document;
	if (!checkDocumentLanguage(doc, 'move')) {
		return vscode.window.showWarningMessage('Can only run *.move file');
	}

	let moveFilePath = doc.fileName;

	let config = loadConfig(doc);
	let workdir = vscode.workspace.getWorkspaceFolder(doc.uri)!;
	let starcoinConfig = vscode.workspace.getConfiguration('starcoin', workdir);
	let nodePath = starcoinConfig.get<string>('nodePath');
	let nodeRpcUrl = starcoinConfig.get<string>('nodeRpcUrl');
	let maxGasAmount = starcoinConfig.get('maxGasAmount', 1000000) || 1000000;

	if (!nodePath) {
		vscode.window.showErrorMessage("starcoin nodePath is not configured");
		return;
	}
	if (!nodeRpcUrl) {
		vscode.window.showErrorMessage("starcoin node rpc url is not configured");
		return;
	}
	let binaryPath = nodePath!;

	let sender = config.sender || undefined;
	if (!sender) {
		const prompt = 'Enter account from which you\'re going to run this script (or set it in config)';
		const placeHolder = '0x6142815e14be403fef8048b945cd4685';

		await vscode.window
			.showInputBox({ prompt, placeHolder })
			.then((value) => (value) && (sender = value));
	}

	if (!sender) {
		return;
	}

	let type_arguments: string[] = [];
	let scriptArgs: string[] = [];
	if (!isDeploy) {
		const scriptName = path.parse(moveFilePath).name;
		let configFromPath = loadScriptArgConfigFromPath(config.compilerDir, scriptName);
		if (configFromPath) {
			type_arguments.push(...configFromPath.type_arguments);
			scriptArgs.push(...configFromPath.arguments);
		} else { // read from user input

			let prompt = "Entry script type arguments, seperate multile arguments with ',' (or leave it empty)";
			let placeHolder = "0x01::STC::STC, 0x01::Coin::Coin";
			let input_type_tags = await vscode.window
				.showInputBox({ prompt, placeHolder, ignoreFocusOut: true });
			if (input_type_tags) {
				type_arguments.push(...input_type_tags.split(",").map(s => s.trim()));
			}

			prompt = "Entry script params, seperate multile params with ',' (or leave it empty)";
			placeHolder = "0x6142815e14be403fef8048b945cd4685, 100000, b\"deadbeef\"";
			let input_arguments = await vscode.window
				.showInputBox({ prompt, placeHolder, ignoreFocusOut: true });
			if (input_arguments) {
				scriptArgs.push(...input_arguments.split(",").map(s => s.trim()));
			}
		}

	}


	const args = [
		'--connect', nodeRpcUrl,
		'-o', 'json',
		'dev', 'execute', '--blocking',
	];

	if (dryRun) {
		args.push('--dry-run', '--local');
	}
	args.push('--sender', sender);
	args.push('--max-gas', maxGasAmount.toString());
	if (type_arguments.length > 0) {
		args.push('-t');
		args.push(...type_arguments);
	}
	if (scriptArgs.length > 0) {
		args.push('--arg');
		args.push(...scriptArgs);
	}

	let deps = [];
	if (!!config.modulesPath && fs.existsSync(config.modulesPath)) {
		let dirEntries = fs.readdirSync(config.modulesPath);
		// exclude move file to run as dependencies
		let modulePaths = dirEntries
			.map(e => path.join(config.modulesPath!, e))
			.filter((d) => d !== moveFilePath);
		modulePaths.forEach(e => console.log(e));
		deps.push(...modulePaths);
	}
	if (deps.length > 0) {
		args.push('--dep');
		args.push(...deps);
	}

	args.push('--');
	args.push(moveFilePath);

	args.unshift(binaryPath);
	let runTask = new vscode.Task(
		{ type: 'move', task: 'exec' },
		workdir,
		'exec',
		'move',
		new vscode.ShellExecution(args.join(' '))
	);

	return vscode.tasks.executeTask(runTask);
}


/**
 * Command: Move: Compile file
 * Logic:
 * - get active editor document, check if it's move
 * - check network
 * - run compillation
 */
async function compileCommand(): Promise<any> {

	// @ts-ignore
	const document = vscode.window.activeTextEditor.document;

	if (!checkDocumentLanguage(document, 'move')) {
		return vscode.window.showWarningMessage('Only .move files are supported by compiler');
	}

	const config = loadConfig(document);
	let sender = config.sender || null;

	// check if account has been preset
	if (!sender) {
		const prompt = 'Enter account from which you\'re going to deploy this script (or set it in config)';
		const placeHolder = '0x...';

		await vscode.window
			.showInputBox({ prompt, placeHolder })
			.then((value) => (value) && (sender = value));
	}

	const workdir = workspace.getWorkspaceFolder(document.uri) || { uri: { fsPath: '' } };
	const outdir = path.join(workdir.uri.fsPath, config.compilerDir);

	checkCreateOutDir(outdir);

	if (!sender) {
		return vscode.window.showErrorMessage('sender is not specified');
	}

	switch (config.network) {
		case 'libra': return compileLibra(sender, document, outdir, config);
		case 'starcoin': return compileLibra(sender, document, outdir, config);
		default: vscode.window.showErrorMessage('Unknown Move network in config: only libra and dfinance supported');
	}
}

function compileLibra(account: string, document: vscode.TextDocument, outdir: string, config: AppConfig) {
	const cfgBinPath = workspace.getConfiguration('move', document.uri).get<string>('moveCompilerPath');
	const executable = (process.platform === 'win32') ? 'move-build.exe' : 'move-build';
	const bin = cfgBinPath || path.join(extensionPath, 'bin', executable);

	const args = [
		,
		'--out-dir', outdir,
		'--sender', account
	];
	const moveFilePath = document.fileName;
	const deps: string[] = [config.stdlibPath, config.modulesPath]
		.filter((a) => !!a)
		.map((a) => a!)
		.filter((a) => fs.existsSync(a))
		.map(depPath => {
			let dirEntries = fs.readdirSync(depPath);
			// exclude move file to run as dependencies
			let modulePaths = dirEntries
				.map(e => path.join(depPath!, e))
				.filter((d) => d !== moveFilePath);
			modulePaths.forEach(e => console.log(e));
			return modulePaths;
		}).flat();

	if (deps.length) {
		args.push('--dependency');
		args.push(...deps);
	}

	args.push('--', moveFilePath);

	const workdir = workspace.getWorkspaceFolder(document.uri);

	if (!workdir) {
		return;
	}

	return vscode.tasks.executeTask(new vscode.Task(
		{ type: 'move', task: 'compile' },
		workdir,
		'compile',
		'move',
		new vscode.ShellExecution(bin + args.join(' '))
	));
}


interface ScriptArgs {
	type_arguments: string[],
	arguments: string[],
}

function loadScriptArgConfigFromPath(argConfigPath: string, script_name: string): ScriptArgs | undefined {
	const scriptConfigPath = path.join(argConfigPath, script_name + '.json');
	if (fs.existsSync(scriptConfigPath)) {
		let data = JSON.parse(fs.readFileSync(scriptConfigPath).toString());
		return {
			type_arguments: data['type_arguments'] || [],
			arguments: data['arguments'] || [],
		};
	} else {
		return undefined;
	}
}

/**
 * Try to load local config. If non existent - use VSCode settings for this
 * extension.
 *
 * @param  {TextDocument} document File for which to load configuration
 * @return {Object}  			   Configuration object
 */
function loadConfig(document: vscode.TextDocument): AppConfig {

	// quick hack to make it extensible. church!
	const moveConfig = workspace.getConfiguration('move', document.uri);
	const workDir = workspace.getWorkspaceFolder(document.uri);
	const folder = (workDir && workDir.uri.fsPath) || extensionPath;
	const localPath = path.join(folder, moveConfig.get('configPath') || '.mvconfig.json');

	const cfg = {
		sender: moveConfig.get<string>('account') || null,
		network: moveConfig.get<string>('blockchain') || 'libra',
		compilerDir: moveConfig.get<string>('compilerDir') || 'out',
		modulesPath: moveConfig.get<string>('modulesPath') || 'modules',
		scriptArgConfigPath: moveConfig.get<string>('scriptArgConfigPath') || undefined,
		stdlibPath: moveConfig.get<string>('stdlibPath') || undefined
	};

	// check if local config exists, then simply merge it right into cfg
	if (fs.existsSync(localPath)) {
		try {
			Object.assign(cfg, JSON.parse(fs.readFileSync(localPath).toString()))
		} catch (e) {
			console.error('Unable to read local config file - check JSON validity: ', e);
		}
	}

	switch (true) {
		case cfg.stdlibPath === undefined:
			cfg.stdlibPath = path.join(extensionPath, 'stdlib', cfg.network);
			break;

		case cfg.stdlibPath === null:
			break;

		case cfg.stdlibPath && !path.isAbsolute(cfg.stdlibPath):
			cfg.stdlibPath = path.join(folder, cfg.stdlibPath || '');
	}

	switch (true) {
		// same here: null, undefined and string // careful
		case cfg.modulesPath === undefined:
			cfg.modulesPath = path.join(folder, 'modules');
			break;

		case cfg.modulesPath === null:
			break;

		case cfg.modulesPath && !path.isAbsolute(cfg.modulesPath):
			cfg.modulesPath = path.join(folder, cfg.modulesPath || '');
	}

	return {
		sender: cfg.sender,
		network: cfg.network,
		compilerDir: cfg.compilerDir,
		// @ts-ignore
		modulesPath: cfg.modulesPath,
		// @ts-ignore
		stdlibPath: cfg.stdlibPath
	};
}

/**
 * Check whether compiler output directory exists: create if not, error when it's a
 *
 * @param   {String}  outDir  Output directory as set in config
 * @throws  {Error} 		  Throw Error when ourDir path exists and is not directory
 */
function checkCreateOutDir(outDir: string): void {
	const outDirPath = path.resolve(outDir);

	if (fs.existsSync(outDirPath)) {
		if (!fs.statSync(outDirPath).isDirectory()) {
			throw new Error('Can\'t create dir under move.compilerDir path - file exists');
		}
	} else {
		fs.mkdirSync(outDirPath);
	}
}

