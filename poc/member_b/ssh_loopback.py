"""Disposable OpenSSH loopback probe for EvoResearch F7."""
import getpass
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time


def run(*args, timeout=10):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=True)


def main():
    with tempfile.TemporaryDirectory(prefix="evr-ssh-", dir="/private/tmp") as root:
        d = Path(root)
        host_key, client_key = d / "host_key", d / "client_key"
        run("/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(host_key))
        run("/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(client_key))
        (d / "authorized_keys").write_text((d / "client_key.pub").read_text())
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        key_type, key_data, *_ = (d / "host_key.pub").read_text().split()
        (d / "known_hosts").write_text(f"[127.0.0.1]:{port} {key_type} {key_data}\n")
        config = d / "sshd_config"
        config.write_text("\n".join([
            f"Port {port}", "ListenAddress 127.0.0.1",
            f"HostKey {host_key}", f"AuthorizedKeysFile {d / 'authorized_keys'}",
            f"PidFile {d / 'sshd.pid'}", "PasswordAuthentication no",
            "KbdInteractiveAuthentication no", "PubkeyAuthentication yes",
            "UsePAM no", "StrictModes no", "PermitRootLogin no",
            "AllowTcpForwarding no", "X11Forwarding no", "PermitTunnel no",
            f"AllowUsers {getpass.getuser()}", "LogLevel ERROR", ""] ))
        server = subprocess.Popen(["/usr/sbin/sshd", "-D", "-e", "-f", str(config)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            for _ in range(40):
                if server.poll() is not None:
                    raise RuntimeError("sshd exited: " + (server.stderr.read() or "")[:500])
                with socket.socket() as s:
                    if s.connect_ex(("127.0.0.1", port)) == 0:
                        break
                time.sleep(0.1)
            else:
                raise RuntimeError("sshd did not listen")
            common = ["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                      "-o", f"UserKnownHostsFile={d / 'known_hosts'}",
                      "-o", "GlobalKnownHostsFile=/dev/null", "-o", "IdentitiesOnly=yes",
                      "-o", "ConnectTimeout=3", "-i", str(client_key), "-p", str(port),
                      f"{getpass.getuser()}@127.0.0.1"]
            probe = run(*common, "printf EVO_OK; printf EVO_ERR >&2; uname -s; if command -v nvidia-smi >/dev/null 2>&1; then echo GPU_TOOL_PRESENT; else echo GPU_TOOL_MISSING; fi")
            assert probe.stdout.startswith("EVO_OK"), probe.stdout
            assert "EVO_ERR" in probe.stderr, probe.stderr
            (d / "wrong_known_hosts").write_text("")
            wrong = common.copy()
            wrong[wrong.index(f"UserKnownHostsFile={d / 'known_hosts'}")] = f"UserKnownHostsFile={d / 'wrong_known_hosts'}"
            rejected = subprocess.run([*wrong, "printf SHOULD_NOT_RUN"], text=True,
                                      capture_output=True, timeout=10)
            assert rejected.returncode != 0 and "SHOULD_NOT_RUN" not in rejected.stdout
            print(json.dumps({"ssh_connected": True, "stdout": probe.stdout.strip(),
                              "stderr_returned": "EVO_ERR" in probe.stderr,
                              "host_key_rejection": True, "remote_exit_code": probe.returncode},
                             ensure_ascii=False))
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    main()
