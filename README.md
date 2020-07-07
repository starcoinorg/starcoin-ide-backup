# Starcoin IDE for VSCode

A vscode plugin for [Starcoin](https://github.com/starcoinorg/starcoin) smart contract developers.
It's modified from origin [damirka/vscode-move-ide](https://github.com/damirka/vscode-move-ide) to integrate with starcoin network.

## IDE Setup

### VSCode workspace settings

```json
{
  "move.blockchain": "starcoin",
  "move.account": "0xac6b029835949e6c0545b87b6d39db1d",
  "move.stdlibPath": "./stdlib",
  "move.modulesPath": "modules",
  "move.scriptArgConfigPath": "inputs",
  "starcoin.nodePath": "/usr/local/bin/starcoin",
  "starcoin.nodeRpcUrl": "ws://127.0.0.1:60929",
  "starcoin.maxGasAmount": 1000000
}
```

**Comments:**

- `move.blockchain`: `libra` or `starcoin` (starcoin is default).
- `move.account`: account from which you're going to deploy/run scripts.
- `move.stdlibPath`: stdlib path, default to stdlib under project dir.
- `move.modulePath`: project path of move modules. Default to `modules` under project dir.
- `move.scriptArgConfigPath`: Path to script arguments config file. Default to `inputs` under project dir.
- `starcoin.nodePath`: path of starcoin node binary.
- `starcoin.nodeRpcUrl`: rpc address of starcoin netowrk.
- `starcoin.maxGasAmount`: max gas used to deploy/run scripts.


## Recomended directory structure

I recommend you using following directory structure:
```
modules/       - here you'll put your modules (module.move)
  |- HelloWorld.move
scripts/       - same here! scripts! (script.move)
  |- say_hi.move
inputs/        - script arguments config file, used when dry-run/run script.
 |- say_hi.json
out/           - compiler output directory (module.mv or module.mv.json)
```

## Script Arguments configuration

You can provide a script argument config file under `move.scriptArgConfigPath`.

The file name should correspond to the script file,
If you script name is `say_hi`, then your script config file name should also be `say_hi`.

An example of such file is:

``` json
{
  "type_arguments": [
    "0x1::STC::STC"
  ],
  "arguments": [
    "0x1",
    "10000"
  ]
}
```

If `type_arguments` or `arguments` is not needed, just remove the field from the json config.


## Contribution

Feel free to ask any questions or report bugs [by opening new issue](https://github.com/starcoinorg/vscode-move-ide/issues).

