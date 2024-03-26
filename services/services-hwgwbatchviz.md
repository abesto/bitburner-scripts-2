---
description: ASCII Art is Great
---

# services/HwgwBatchViz

* Code: [https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/HwgwBatchViz](https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/HwgwBatchViz)
* Dependencies: [services-database.md](services-database.md "mention") for some configuration options
* In-game RAM: 2.30GB

<figure><img src="../.gitbook/assets/image (2).png" alt=""><figcaption></figcaption></figure>

The Bitburner manual describes the basics of HWGW batching at [https://bitburner.readthedocs.io/en/latest/advancedgameplay/hackingalgorithms.html#batch-algorithms-hgw-hwgw-or-cycles](https://bitburner.readthedocs.io/en/latest/advancedgameplay/hackingalgorithms.html#batch-algorithms-hgw-hwgw-or-cycles), so I don't consider this spoilery.

Here's the basic idea: run `hack`, `weaken`, and `grow` processes overlapping each other (and overlapping other batches). The challenge is to do this safely. I will not write about how to do it safely, there are much better resources for that, especially on the Bitburner Discord.

This service exists to help visualize the state of HWGW batching. The X axis is time; each line is a single job. Each quartet of lines is an HWGW batch. The dark parts are in the future; the bright parts are in the past. The legend from the screenshot should make everything else pretty clear.

## How Does It Work?

Data is reported by [bin-hwgw-batch.md](../other-binaries/bin-hwgw-controller/bin-hwgw-batch.md "mention"): whenever a job is planned, started, or finished, it sends a request to the server port of `HwgwBatchViz`. The service updates the UI every second to reflect the current state. The algorithm for rendering the charts is somewhat nuanced, but not very interesting to talk about; check out the code if you're interested!

Note that Bitburner supports 256-color foreground colors, but not 24-bit foreground colors, and no background colors at all. This still gives us enough color space to do the shading with colors. That's great, as it allows usage of partial block characters to cheat in some extra resolution at the start and end of jobs.
