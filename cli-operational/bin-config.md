---
description: Read and Write Config Values
---

# bin/config

Services and CLIs may take configuration values. Well-behaved long-running processes re-read config values reasonably frequently.

This CLI exists to inspect and change configuration values. Default configuration values are hard-coded in `src/database.ts`.

## Get current config values

Dump all available configuration

{% code overflow="wrap" %}
```json
[home /]> config get
Running script with 1 thread(s), pid 1450 and args: ["get"].
{"database":{"debugLocks":false},"share":{"percentage":0.75,"max":1000000},"simpleHack":{"moneyThreshold":0.75,"securityThreshold":5},"hwgw":{"moneyThreshold":0.5,"spacing":500,"maxDepth":0,"hackSkillRangeMult":1.05,"batchViz":{"centerBias":0.5}},"scheduler":{"reserveHomeRam":8},"autobuyServers":{"reserveMoney":"$10b","buyAt":"30m","intervalMs":5000}}
```
{% endcode %}

Configuration for a specific service / behavior

```json
[home /]> config get autobuyServers
Running script with 1 thread(s), pid 1563 and args: ["get","autobuyServers"].
{"reserveMoney":"$10b","buyAt":"30m","intervalMs":5000}
```

Specific config value

```
[home /]> config get autobuyServers.reserveMoney 
Running script with 1 thread(s), pid 1589 and args: ["get","autobuyServers.reserveMoney"].
$10b
```

<figure><img src="../.gitbook/assets/image.png" alt=""><figcaption><p>Auto-completion knows about available config keys:</p></figcaption></figure>

## Set config value

<figure><img src="../.gitbook/assets/image (1).png" alt=""><figcaption><p>Simple as</p></figcaption></figure>
