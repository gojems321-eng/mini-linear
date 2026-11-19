#!/usr/bin/env python3
"""Double-fork daemonizer.

Processes started from tool calls are reaped when the call ends; a
double-forked grandchild (reparented to init in its own session) survives.
Usage: python3 daemon-start.py <command...>   (log: /home/z/my-project/dev.log)
"""
import os
import sys

LOG = '/home/z/my-project/dev.log'
CWD = '/home/z/my-project'


def daemonize(cmd):
    pid = os.fork()
    if pid == 0:
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:
            os.chdir(CWD)
            fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            devnull = os.open(os.devnull, os.O_RDONLY)
            os.dup2(devnull, 0)
            os.execvp(cmd[0], cmd)
            os._exit(127)
        os._exit(0)
    os.waitpid(pid, 0)


if __name__ == '__main__':
    daemonize(sys.argv[1:])
    print('daemonized:', ' '.join(sys.argv[1:]))
