using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private const string BaseUrl = "https://auth.mad4b.com";
    private const string LocalManagerUrl = BaseUrl + "/app/local-manager";
    private const string SignInUrl = BaseUrl + "/app/local-manager/sign-in?source=windows-app";
    private const string SignUpUrl = BaseUrl + "/app/local-manager/sign-up?source=windows-app";
    private const string PairingUrl = BaseUrl + "/app/local-manager/link-device?platform=windows&source=windows-app";
    private const string DevicesUrl = BaseUrl + "/app/local-manager/devices?source=windows-app";
    private const string RoutesUrl = BaseUrl + "/app/local-manager/routes?source=windows-app";
    private const string BackupsUrl = BaseUrl + "/app/local-manager/backups?source=windows-app";
    private const string SettingsUrl = BaseUrl + "/app/local-manager/settings?source=windows-app";
    private const string UpdateUrl = BaseUrl + "/app/local-manager/download/windows";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private sealed class MainForm : Form
    {
        private readonly Label _status;
        private readonly ProgressBar _progress;

        public MainForm()
        {
            Text = "Mad4B Local Manager";
            MinimumSize = new Size(760, 560);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10);

            var title = new Label
            {
                Text = "Mad4B Local Manager",
                Font = new Font("Segoe UI", 22, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 20)
            };

            var body = new Label
            {
                Text = "Sign in with Mad4B, link this Windows device, then manage routes, backups, DR probes, and settings.\n\nThis app contains no backend key, platform token, or device credential.",
                AutoSize = false,
                Location = new Point(28, 72),
                Size = new Size(680, 74)
            };

            var signInButton = MakeButton("Sign in", 28, 164, 150, (_, _) => OpenUrl(SignInUrl));
            var signUpButton = MakeButton("Create account", 194, 164, 160, (_, _) => OpenUrl(SignUpUrl));
            var linkButton = MakeButton("Link this device", 370, 164, 170, (_, _) => OpenUrl(PairingUrl));
            var openButton = MakeButton("Open Local Manager", 556, 164, 170, (_, _) => OpenUrl(LocalManagerUrl));

            var devicesButton = MakeButton("My devices", 28, 236, 150, (_, _) => OpenUrl(DevicesUrl));
            var routesButton = MakeButton("Routes", 194, 236, 150, (_, _) => OpenUrl(RoutesUrl));
            var backupsButton = MakeButton("Backups / DR", 360, 236, 160, (_, _) => OpenUrl(BackupsUrl));
            var settingsButton = MakeButton("Settings", 536, 236, 150, (_, _) => OpenUrl(SettingsUrl));

            var shortcutButton = MakeButton("Create desktop shortcut", 28, 310, 210, (_, _) => CreateShortcut());
            var folderButton = MakeButton("Open local folder", 254, 310, 170, (_, _) => OpenLocalFolder());
            var updateButton = MakeButton("Check / install update", 440, 310, 200, async (_, _) => await DownloadAndRunLatestAsync());

            _status = new Label
            {
                Name = "StatusLabel",
                Text = "Ready. No secrets are stored by this app.",
                AutoSize = false,
                Location = new Point(28, 386),
                Size = new Size(680, 48)
            };

            _progress = new ProgressBar
            {
                Location = new Point(28, 444),
                Size = new Size(680, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            var note = new Label
            {
                Text = "After sign-in, the web dashboard controls access by your Mad4B account role. Device credentials are issued only after the link-device consent flow.",
                AutoSize = false,
                Location = new Point(28, 482),
                Size = new Size(680, 44)
            };

            Controls.AddRange(new Control[]
            {
                title, body,
                signInButton, signUpButton, linkButton, openButton,
                devicesButton, routesButton, backupsButton, settingsButton,
                shortcutButton, folderButton, updateButton,
                _status, _progress, note
            });

            Shown += (_, _) => EnsureLocalFiles(_status);
        }

        private static Button MakeButton(string text, int x, int y, int width, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(width, 42)
            };
            button.Click += onClick;
            return button;
        }

        private static string InstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mad4B", "LocalManager");
        private static string UpdatesRoot => Path.Combine(InstallRoot, "updates");

        private static void EnsureLocalFiles(Label? status = null)
        {
            Directory.CreateDirectory(InstallRoot);
            Directory.CreateDirectory(UpdatesRoot);
            var readme = Path.Combine(InstallRoot, "README.txt");
            File.WriteAllText(readme,
                "Mad4B Local Manager\r\n\r\n" +
                "This app contains no backend key, platform token, or device credential.\r\n" +
                "Open Local Manager, sign in, and link this device through the platform flow.\r\n\r\n" +
                $"Local Manager URL: {LocalManagerUrl}\r\n" +
                $"Sign in URL: {SignInUrl}\r\n" +
                $"Link-device URL: {PairingUrl}\r\n" +
                $"Update URL: {UpdateUrl}\r\n" +
                $"Installed at: {InstallRoot}\r\n");
            if (status is not null) status.Text = $"Local files prepared at {InstallRoot}";
        }

        private void CreateShortcut()
        {
            EnsureLocalFiles(_status);
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcut = Path.Combine(desktop, "Mad4B Local Manager.url");
            File.WriteAllText(shortcut, "[InternetShortcut]\r\nURL=" + LocalManagerUrl + "\r\nIconIndex=0\r\n");
            _status.Text = $"Shortcut created: {shortcut}";
        }

        private void OpenLocalFolder()
        {
            EnsureLocalFiles(_status);
            Process.Start(new ProcessStartInfo { FileName = InstallRoot, UseShellExecute = true });
        }

        private async Task DownloadAndRunLatestAsync()
        {
            try
            {
                EnsureLocalFiles(_status);
                _status.Text = "Checking latest Windows app…";
                _progress.Value = 0;

                using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
                using var response = await client.GetAsync(UpdateUrl, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();

                var total = response.Content.Headers.ContentLength;
                var target = Path.Combine(UpdatesRoot, "Mad4B-Local-Manager-Setup-latest.exe");
                await using var source = await response.Content.ReadAsStreamAsync();
                await using var destination = File.Create(target);

                var buffer = new byte[81920];
                long readTotal = 0;
                while (true)
                {
                    var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length));
                    if (read == 0) break;
                    await destination.WriteAsync(buffer.AsMemory(0, read));
                    readTotal += read;
                    if (total.HasValue && total.Value > 0)
                    {
                        var pct = (int)Math.Min(100, (readTotal * 100L) / total.Value);
                        _progress.Value = pct;
                    }
                }

                _progress.Value = 100;
                _status.Text = $"Latest installer downloaded: {target}. Launching…";
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
            }
            catch (Exception ex)
            {
                _status.Text = "Update failed: " + ex.Message;
            }
        }

        private static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
    }
}
