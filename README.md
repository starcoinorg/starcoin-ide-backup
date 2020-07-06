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
  "starcoin.nodePath": "/usr/local/bin/starcoin",
  "starcoin.nodeRpcUrl": "ws://127.0.0.1:60929",
  "starcoin.maxGasAmount": 1000000
}
```

**Comments:**

- move.blockchain: `libra` or `starcoin` (starcoin is default).
- move.account: account from which you're going to deploy/run scripts.
- move.stdlibPath: stdlib path, default to stdlib under project dir.
- move.modulePath: project path of move modules. Default to `modules` under project dir.
- starcoin.nodePath: path of starcoin node binary.
- starcoin.nodeRpcUrl: rpc address of starcoin netowrk.
- starcoin.maxGasAmount: max gas used to deploy/run scripts.


## Recomended directory structure

I recommend you using following directory structure:
```
modules/       - here you'll put your modules (module.move)
scripts/       - same here! scripts! (script.move)
out/           - compiler output directory (module.mv or module.mv.json)
```

## Contribution

Feel free to ask any questions or report bugs [by opening new issue](https://github.com/starcoinorg/vscode-move-ide/issues).

