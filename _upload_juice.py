import os
import paramiko

local_dir = r"C:\Users\Wxcked\Desktop\mailer-app\public\assets\music\juice"
remote_dir = "/opt/mailer-app/public/assets/music/juice"
index_local = r"C:\Users\Wxcked\Desktop\mailer-app\public\index.html"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("103.214.71.104", username="root", password="zFZ5C6S9Qu90LlZxW0BS", timeout=30)
c.exec_command("mkdir -p " + remote_dir)
sftp = c.open_sftp()
sftp.put(index_local, "/opt/mailer-app/public/index.html")
print("put index.html")
for name in sorted(os.listdir(local_dir)):
    if not name.lower().endswith(".mp3"):
        continue
    local = os.path.join(local_dir, name)
    remote = remote_dir + "/" + name
    print("uploading", name, os.path.getsize(local))
    sftp.put(local, remote)
    print("put", name)
sftp.close()
c.close()
print("done")
