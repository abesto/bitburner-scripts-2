import { NS } from '@ns';

import * as asciichart from 'asciichart';

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  const arr1 = new Array(120);
  arr1[0] = Math.round(Math.random() * 15);
  for (let i = 1; i < arr1.length; i++)
    arr1[i] =
      arr1[i - 1] + Math.round(Math.random() * (Math.random() > 0.5 ? 2 : -2));

  const arr2 = new Array(120);
  arr2[0] = Math.round(Math.random() * 15);
  for (let i = 1; i < arr2.length; i++)
    arr2[i] =
      arr2[i - 1] + Math.round(Math.random() * (Math.random() > 0.5 ? 2 : -2));

  const arr3 = new Array(120);
  arr3[0] = Math.round(Math.random() * 15);
  for (let i = 1; i < arr3.length; i++)
    arr3[i] =
      arr3[i - 1] + Math.round(Math.random() * (Math.random() > 0.5 ? 2 : -2));

  const arr4 = new Array(120);
  arr4[0] = Math.round(Math.random() * 15);
  for (let i = 1; i < arr4.length; i++)
    arr4[i] =
      arr4[i - 1] + Math.round(Math.random() * (Math.random() > 0.5 ? 2 : -2));

  const config: asciichart.PlotConfig = {
    colors: [
      asciichart.blue,
      asciichart.red,
      asciichart.lightgray,
      asciichart.magenta,
    ],
    height: 10,
  };

  ns.print(asciichart.plot([arr1, arr2, arr3, arr4], config));
}
