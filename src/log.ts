import { NS } from '@ns';

import chalk from 'chalk';
import { highlightValue } from './fmt';

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export class Log {
  constructor(private readonly ns: NS, private readonly name: string) {
    this.ns.disableLog("ALL");
  }

  scope(name: string): Log {
    return new Log(this.ns, `${this.name}.${name}`);
  }

  timestampField(): string {
    const date = new Date();
    const str = `[${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}]`;
    return chalk.black(str);
  }

  levelField(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return chalk.black("debug");
      case LogLevel.INFO:
        return chalk.green(" info");
      case LogLevel.WARN:
        return chalk.yellow(" warn");
      case LogLevel.ERROR:
        return chalk.red("error");
    }
  }

  keyvalueField(keyvalue: { [key: string]: unknown }): string {
    const parts = [];
    for (const [key, value] of Object.entries(keyvalue)) {
      parts.push(`${chalk.cyan(key)}=${highlightValue(value)}`);
    }
    return parts.join(" ");
  }

  nameField(): string {
    return chalk.gray("[" + this.name.padStart(10, " ") + "]");
  }

  format(
    level: LogLevel,
    message: string,
    keyvalue: { [key: string]: unknown }
  ): string {
    return `${this.timestampField()} ${this.levelField(
      level
    )} ${this.nameField()} ${chalk.white(message)} ${this.keyvalueField(
      keyvalue
    )}`;
  }

  log(
    level: LogLevel,
    message: string,
    keyvalue: { [key: string]: unknown }
  ): void {
    this.ns.printf("%s", this.format(level, message, keyvalue));
  }

  debug(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.log(LogLevel.DEBUG, message, keyvalue);
  }

  info(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.log(LogLevel.INFO, message, keyvalue);
  }

  warn(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.log(LogLevel.WARN, message, keyvalue);
  }

  error(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.log(LogLevel.ERROR, message, keyvalue);
  }

  tlog(
    level: LogLevel,
    message: string,
    keyvalue: { [key: string]: unknown }
  ): void {
    this.ns.tprintf("%s", this.format(level, message, keyvalue));
  }

  tdebug(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.tlog(LogLevel.DEBUG, message, keyvalue);
  }

  tinfo(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.tlog(LogLevel.INFO, message, keyvalue);
  }

  twarn(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.tlog(LogLevel.WARN, message, keyvalue);
  }

  terror(message: string, keyvalue: { [key: string]: unknown } = {}): void {
    this.tlog(LogLevel.ERROR, message, keyvalue);
  }
}
