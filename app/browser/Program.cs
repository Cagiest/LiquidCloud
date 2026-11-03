// LiquidCloud's SoundCloud window: soundcloud.com in WebView2 (Microsoft Edge's engine, built into Windows),
// which plays every track including encrypted ones. Started by the companion (../main.js) with:
//   --theme <file>     the theme script (the userscript with its stand-ins, built by build-theme.js)
//   --adblock <file>   the ad-blocking list (adblock.json: domains, and URL starts)
//   --connect <hosts>  the sites the theme may reach besides the companion (the userscript's @connect)
//   --port <n>         the companion, at http://127.0.0.1:<n>
//   --data <dir>       where the browser profile (sign-in, cookies) and the window position are kept
//
// What it does for the theme, which was written for Tampermonkey: runs it in every SoundCloud page, and
// answers its requests (window.__liquid.request, over WebView2's messages): the companion's /state and
// /settings, or an allowed site. Sound levels for the aura go to the companion's /audio. The companion's
// /state replies carry the ad-blocking switch and commands (play / next / previous / show).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LiquidCloud
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // one SoundCloud window: a second start (the companion asks only when it sees none) just exits
            using var only = new Mutex(true, "LiquidCloud.Browser", out bool first);
            if (!first) return;
            ApplicationConfiguration.Initialize();
            Application.Run(new SoundCloudWindow(Options.Parse(args)));
        }
    }

    sealed class Options
    {
        public string Theme, AdBlock, Data;
        public string Profile = "profile";
        public bool Plain, NoDevLog;                // for testing features one at a time
        public string[] Connect = Array.Empty<string>();
        public int Port = 8766;

        public static Options Parse(string[] args)
        {
            var o = new Options { Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LiquidCloud") };
            // switches without a value
            o.Plain = args.Contains("--plain");
            o.NoDevLog = args.Contains("--no-devlog");
            args = args.Where(a => a != "--plain" && a != "--no-devlog").ToArray();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string v = args[i + 1];
                switch (args[i])
                {
                    case "--theme": o.Theme = v; break;
                    case "--adblock": o.AdBlock = v; break;
                    case "--connect": o.Connect = v.Split(',', StringSplitOptions.RemoveEmptyEntries); break;
                    case "--port": int.TryParse(v, out o.Port); break;
                    case "--data": o.Data = v; break;
                    case "--profile": o.Profile = v; break;
                }
            }
            return o;
        }
    }

    sealed class SoundCloudWindow : Form
    {
        /* ---------- No Windows title bar ----------
           The theme's top bar is the title bar (like Discord's): the window keeps its frame, so it still
           resizes from its edges, snaps and has Windows' shadow and rounded corners, but the caption area
           is handed to the page. The bar's CSS marks it app-region: drag, which WebView2 turns into the
           window's caption (dragging, double-click to maximise, snap layouts). A 3px strip above the page
           resizes from the top edge. */
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct NCCALCSIZE_PARAMS { public RECT R0, R1, R2; public IntPtr Pos; }
        const int WM_NCCALCSIZE = 0x83, WM_NCHITTEST = 0x84;
        const int HTCLIENT = 1, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
        const int TopGrip = 3;

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (options?.Plain == true) return;
            int dark = 1;
            DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE (frame and shadow)
            SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020); // NOSIZE NOMOVE NOZORDER FRAMECHANGED
        }

        protected override void WndProc(ref Message m)
        {
            if (options == null || options.Plain) { base.WndProc(ref m); return; }
            if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
            {
                // let Windows size the side and bottom edges, then give the caption area back to the page
                int top = Marshal.PtrToStructure<NCCALCSIZE_PARAMS>(m.LParam).R0.Top;
                base.WndProc(ref m);
                var p = Marshal.PtrToStructure<NCCALCSIZE_PARAMS>(m.LParam);
                // maximised, Windows puts the frame just off screen: keep the page's top on screen. (Asked of
                // Windows itself: WinForms' WindowState is not updated yet when this arrives, which cut the top off.)
                p.R0.Top = top + (IsZoomed(Handle) ? GetSystemMetrics(33) + GetSystemMetrics(92) : 0);
                Marshal.StructureToPtr(p, m.LParam, false);
                m.Result = IntPtr.Zero;
                return;
            }
            base.WndProc(ref m);
            if (m.Msg == WM_NCHITTEST && (int)m.Result == HTCLIENT && WindowState == FormWindowState.Normal)
            {
                var pt = PointToClient(new Point(unchecked((short)(long)m.LParam), unchecked((short)((long)m.LParam >> 16))));
                if (pt.Y < TopGrip) m.Result = (IntPtr)(pt.X < 8 ? HTTOPLEFT : pt.X > ClientSize.Width - 8 ? HTTOPRIGHT : HTTOP);
            }
        }

        // the page learns whether the window is maximised (its maximise button turns into restore)
        void SendWindowState()
        {
            if (!options.Plain) Padding = new Padding(0, IsZoomed(Handle) || WindowState == FormWindowState.Minimized ? 0 : TopGrip, 0, 0);
            view.CoreWebView2?.PostWebMessageAsJson(new JsonObject { ["type"] = "window-state", ["maximized"] = WindowState == FormWindowState.Maximized }.ToJsonString());
        }

        void WindowCommand(string action)
        {
            switch (action)
            {
                case "minimize": WindowState = FormWindowState.Minimized; break;
                case "maximize": WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
                case "close": Close(); break;
            }
            SendWindowState();
        }

        const string Home = "https://soundcloud.com/";
        // pages that may open inside the app: SoundCloud and the sign-in providers it offers
        static readonly string[] InApp = { "soundcloud.com", "sndcdn.com", "google.com", "apple.com", "facebook.com" };

        readonly Options options;
        readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(18, 18, 18) };
        readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        readonly string boundsFile;
        readonly HashSet<string> blockedDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly List<string> blockedUrls = new List<string>();
        bool blockAds = true;
        // SoundCloud's own audio ads: blocked only when the companion's "Also block SoundCloud's audio ads" is on
        readonly HashSet<string> scAdDomains = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly List<string> scAdUrls = new List<string>();
        readonly List<string> scAdPatterns = new List<string>();
        readonly List<System.Text.RegularExpressions.Regex> scAdRegexes = new List<System.Text.RegularExpressions.Regex>();
        bool blockSoundCloudAds = false;

        public SoundCloudWindow(Options options)
        {
            this.options = options;
            boundsFile = Path.Combine(options.Data, "window.json");
            Text = "LiquidCloud";
            BackColor = Color.FromArgb(12, 12, 12); // the strip above the page matches the top bar
            MinimumSize = new Size(900, 600);
            Size = new Size(1440, 900);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            LoadBounds();
            Controls.Add(view);
            LoadAdBlockList();
            Load += async (s, e) => await Start();
            FormClosing += OnClosing;
            Resize += (s, e) => SendWindowState();
        }

        async Task Start()
        {
            // (not the earlier "webview2" folder: SoundCloud stopped giving that one keys after a run of refused requests)
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(options.Data, options.Profile));
            await view.EnsureCoreWebView2Async(env);
            var web = view.CoreWebView2;
            web.Settings.IsStatusBarEnabled = false;
            web.Settings.AreDevToolsEnabled = true; // F12, for troubleshooting
            web.Settings.IsNonClientRegionSupportEnabled = !options.Plain; // CSS app-region: drag = the window's caption
            web.DocumentTitleChanged += (s, e) => Text = string.IsNullOrEmpty(web.DocumentTitle) ? "LiquidCloud" : $"{web.DocumentTitle} — LiquidCloud";

            // ad blocking: requests to the listed ad networks are answered with nothing
            // (only the listed domains and addresses are watched, so the music itself is never slowed down)
            web.WebResourceRequested += (s, e) =>
            {
                // after two refusals, key requests are answered here instead of reaching SoundCloud (see KeyRefused)
                if (e.Request.Uri.StartsWith(LicenceServer) && e.Request.Method == "POST" && DateTime.Now < holdKeysUntil)
                {
                    e.Response = env.CreateWebResourceResponse(null, 503, "Held back", "");
                    Diagnose("key request held back (after refusals)");
                    return;
                }
                bool block = (blockAds && IsBlocked(e.Request.Uri)) || (blockAds && blockSoundCloudAds && IsSoundCloudAd(e.Request.Uri));
                if (!block) return;
                e.Response = env.CreateWebResourceResponse(null, 403, "Blocked", "");
                if (e.Request.Uri.Contains("soundcloud")) Diagnose($"ad blocker stopped {Short(e.Request.Uri)}");
            };
            foreach (var d in blockedDomains)
            {
                web.AddWebResourceRequestedFilter($"*://{d}/*", CoreWebView2WebResourceContext.All);
                web.AddWebResourceRequestedFilter($"*://*.{d}/*", CoreWebView2WebResourceContext.All);
            }
            foreach (var u in blockedUrls) web.AddWebResourceRequestedFilter(u + "*", CoreWebView2WebResourceContext.All);
            web.AddWebResourceRequestedFilter(LicenceServer + "*", CoreWebView2WebResourceContext.All);
            foreach (var d in scAdDomains)
            {
                web.AddWebResourceRequestedFilter($"*://{d}/*", CoreWebView2WebResourceContext.All);
                web.AddWebResourceRequestedFilter($"*://*.{d}/*", CoreWebView2WebResourceContext.All);
            }
            foreach (var u in scAdUrls) web.AddWebResourceRequestedFilter(u + "*", CoreWebView2WebResourceContext.All);
            foreach (var pattern in scAdPatterns) web.AddWebResourceRequestedFilter(pattern, CoreWebView2WebResourceContext.All);

            // the theme, in every SoundCloud page (top window only), once the page is ready
            if (options.Theme != null && File.Exists(options.Theme))
            {
                string theme = File.ReadAllText(options.Theme);
                await web.AddScriptToExecuteOnDocumentCreatedAsync(
                    "if (window.top === window && location.hostname === 'soundcloud.com') {" +
                    "  const run = () => {" + theme + "};" +
                    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();" +
                    "}");
            }
            web.WebMessageReceived += OnMessage;

            // playback.log: what happens when songs play, for tracking down ones that will not
            web.WebResourceResponseReceived += (s, e) =>
            {
                string uri = e.Request.Uri;
                int status = e.Response.StatusCode;
                if (uri.Contains("license.media-streaming.soundcloud.cloud") && e.Request.Method == "POST")
                {
                    Diagnose($"licence answer {status}");
                    if (status == 403) KeyRefused();
                }
                else if (status >= 400 && (uri.Contains("soundcloud") || uri.Contains("sndcdn"))) Diagnose($"{status} {e.Request.Method} {Short(uri)}");
            };
            if (!options.NoDevLog) await web.CallDevToolsProtocolMethodAsync("Log.enable", "{}");
            web.GetDevToolsProtocolEventReceiver("Log.entryAdded").DevToolsProtocolEventReceived += (s, e) =>
            {
                try
                {
                    var entry = JsonNode.Parse(e.ParameterObjectAsJson)?["entry"];
                    string text = (string)entry?["text"] ?? "";
                    if (text.Length > 300) text = text.Substring(0, 300) + "…";
                    if ((string)entry?["level"] == "error") Diagnose($"page error: {text} {Short((string)entry["url"] ?? "")}");
                }
                catch { }
            };
            web.ProcessFailed += (s, e) => Diagnose($"browser process failed: {e.ProcessFailedKind} {e.Reason}");

            // sign-in pop-ups stay in the app; other links open in your browser
            web.NewWindowRequested += (s, e) =>
            {
                if (!IsInApp(e.Uri)) { e.Handled = true; OpenExternal(e.Uri); }
            };
            web.NavigationStarting += (s, e) =>
            {
                if (!IsInApp(e.Uri) && !e.Uri.StartsWith("about:")) { e.Cancel = true; OpenExternal(e.Uri); }
            };

            web.Navigate(Home);
        }

        // Closing pauses playback first and then lets WebView2 shut down normally, so SoundCloud's playback session
        // ends properly. (Killing the window mid-song left the session open; the next start was refused, most
        // likely as a second stream at once.)
        bool pausedForClose;
        async void OnClosing(object sender, FormClosingEventArgs e)
        {
            SaveBounds();
            if (pausedForClose || view.CoreWebView2 == null) return;
            e.Cancel = true;
            pausedForClose = true;
            try { await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('.playControls__play.playing')?.click()"); } catch { }
            await Task.Delay(600);
            Diagnose("window closed");
            Close();
        }

        /* ---------- Diagnostics (playback.log, last 3000 lines) ---------- */
        readonly object logLock = new object();
        void Diagnose(string line)
        {
            string file = Path.Combine(options.Data, "playback.log");
            lock (logLock)
            {
                try
                {
                    var lines = File.Exists(file) ? File.ReadAllLines(file).ToList() : new List<string>();
                    lines.Add($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}");
                    File.WriteAllLines(file, lines.Skip(Math.Max(0, lines.Count - 3000)));
                }
                catch { }
            }
        }

        // an address without its query (which can hold sign-in tokens)
        static string Short(string url)
        {
            int q = url.IndexOf('?');
            return q < 0 ? url : url.Substring(0, q);
        }

        /* ---------- The theme's messages ---------- */
        async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            JsonNode msg;
            try { msg = JsonNode.Parse(e.WebMessageAsJson); } catch { return; }
            if (!e.Source.StartsWith(Home)) return;
            string type = (string)msg?["type"];

            if (type == "log")
            {
                Diagnose($"page: {(string)msg["text"]}");
                return;
            }
            if (type == "window")
            {
                WindowCommand((string)msg["action"]);
                return;
            }
            if (type == "audio")
            {
                _ = Post("/audio", msg["levels"]?.ToJsonString() ?? "{}");
                return;
            }
            if (type != "request") return;

            var id = msg["id"]?.GetValue<int>() ?? 0;
            var o = msg["options"];
            var result = await Request(o);
            var reply = new JsonObject { ["type"] = "response", ["id"] = id, ["result"] = result };
            view.CoreWebView2?.PostWebMessageAsJson(reply.ToJsonString());
        }

        async Task<JsonNode> Request(JsonNode o)
        {
            string url = (string)o?["url"];
            if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out var uri)) return Error("blocked");
            string method = ((string)o["method"] ?? "GET").ToUpperInvariant();
            string data = o["data"]?.GetValueKind() == JsonValueKind.String ? (string)o["data"] : null;
            bool companion = uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == options.Port && (uri.AbsolutePath == "/state" || uri.AbsolutePath == "/settings");
            bool allowedSite = uri.Scheme == "https" && options.Connect.Any(h => uri.Host == h || uri.Host.EndsWith("." + h));
            if (!companion && !allowedSite) return Error("blocked");
            try
            {
                using var req = new HttpRequestMessage(new HttpMethod(method), uri);
                if (data != null && method != "GET") req.Content = new StringContent(data, Encoding.UTF8, companion ? "application/json" : "text/plain");
                if (companion) req.Headers.Add("X-LiquidCloud-Window", "1"); // tells the companion this is the window, not a browser
                if (o["headers"] is JsonObject headers && !companion)
                    foreach (var h in headers) req.Headers.TryAddWithoutValidation(h.Key, (string)h.Value);
                using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Min(o["timeout"]?.GetValue<double>() ?? 15000, 30000)));
                using var res = await http.SendAsync(req, cts.Token);
                string text = await res.Content.ReadAsStringAsync();
                if (companion && uri.AbsolutePath == "/state") ApplyCompanion(text);
                return new JsonObject { ["status"] = (int)res.StatusCode, ["responseText"] = text, ["finalUrl"] = res.RequestMessage?.RequestUri?.ToString() ?? url };
            }
            catch (TaskCanceledException) { return Error("timeout"); }
            catch { return Error("failed"); }
        }

        static JsonNode Error(string what) => new JsonObject { ["error"] = what };

        Task Post(string path, string json) =>
            http.SendAsync(new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{options.Port}{path}")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
                Headers = { { "X-LiquidCloud-Window", "1" } }
            }).ContinueWith(t => { });

        /* ---------- When SoundCloud refuses keys ----------
           A refused key makes SoundCloud's player skip to the next track, which is refused too, and so on through
           the whole queue: dozens of refused requests a minute, after which SoundCloud stopped giving this
           profile keys at all. So after two refusals within 15 seconds the player is paused and you are told
           once, instead of letting it run through the queue. */
        readonly Queue<DateTime> refusals = new Queue<DateTime>();
        bool toldAboutRefusals;
        DateTime holdKeysUntil = DateTime.MinValue;
        const string LicenceServer = "https://license.media-streaming.soundcloud.cloud/";
        void KeyRefused()
        {
            var now = DateTime.Now;
            lock (refusals)
            {
                refusals.Enqueue(now);
                while (refusals.Count > 0 && now - refusals.Peek() > TimeSpan.FromSeconds(15)) refusals.Dequeue();
                if (refusals.Count < 2) return;
                refusals.Clear();
            }
            holdKeysUntil = now.AddMinutes(10);
            Diagnose("two keys refused within 15 s: player paused, key requests held back for 10 minutes");
            BeginInvoke(async () =>
            {
                await view.CoreWebView2?.ExecuteScriptAsync("document.querySelector('.playControls__play.playing')?.click()");
                if (toldAboutRefusals) return;
                toldAboutRefusals = true;
                MessageBox.Show(this,
                    "SoundCloud refused to play this song (it would not give LiquidCloud its decryption key), so playback was paused instead of skipping through your queue, " +
                    "and LiquidCloud will not ask SoundCloud for keys again for 10 minutes (asking again and again gets refused for much longer).\n\n" +
                    "Unencrypted songs still play. The details are in playback.log in %APPDATA%\\LiquidCloud.",
                    "LiquidCloud", MessageBoxButtons.OK, MessageBoxIcon.Information);
            });
        }

        // the companion's reply to /state: { ..., app: { blockAds, commands } }
        void ApplyCompanion(string text)
        {
            JsonNode app;
            try { app = JsonNode.Parse(text)?["app"]; } catch { return; }
            if (app == null) return;
            if (app["blockAds"]?.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
            {
                bool next = app["blockAds"].GetValue<bool>();
                if (next != blockAds) Diagnose($"ad blocking {(next ? "on" : "off")}");
                blockAds = next;
            }
            if (app["blockSoundCloudAds"]?.GetValueKind() is JsonValueKind.True or JsonValueKind.False)
            {
                bool next = app["blockSoundCloudAds"].GetValue<bool>();
                if (next != blockSoundCloudAds) Diagnose($"blocking SoundCloud's audio ads {(next ? "on" : "off")}");
                blockSoundCloudAds = next;
            }
            if (app["commands"] is not JsonArray commands) return;
            foreach (var c in commands)
            {
                string name = (string)c;
                BeginInvoke(() =>
                {
                    if (name == "show") { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); return; }
                    if (name == "quit") { Close(); return; }
                    string button = name switch { "play" => ".playControls__play", "next" => ".skipControl__next", "previous" => ".skipControl__previous", _ => null };
                    if (button != null) _ = view.CoreWebView2?.ExecuteScriptAsync($"document.querySelector('{button}')?.click()");
                });
            }
        }

        /* ---------- Ad blocking ---------- */
        void LoadAdBlockList()
        {
            try
            {
                var list = JsonNode.Parse(File.ReadAllText(options.AdBlock));
                foreach (var d in list["domains"].AsArray()) blockedDomains.Add((string)d);
                foreach (var u in list["urls"].AsArray()) blockedUrls.Add((string)u);
                var sc = list["soundcloudAds"];
                if (sc != null)
                {
                    foreach (var d in sc["domains"].AsArray()) scAdDomains.Add((string)d);
                    foreach (var u in sc["urls"].AsArray()) scAdUrls.Add((string)u);
                    foreach (var pt in sc["patterns"].AsArray())
                    {
                        scAdPatterns.Add((string)pt);
                        // the same "*" wildcards WebView2's filters use, for matching here
                        scAdRegexes.Add(new System.Text.RegularExpressions.Regex("^" + System.Text.RegularExpressions.Regex.Escape((string)pt).Replace("\\*", ".*") + "$",
                            System.Text.RegularExpressions.RegexOptions.IgnoreCase));
                    }
                }
            }
            catch { }
        }

        bool IsSoundCloudAd(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
            if (scAdUrls.Any(u => url.StartsWith(u, StringComparison.OrdinalIgnoreCase))) return true;
            if (scAdRegexes.Any(r => r.IsMatch(url))) return true;
            return scAdDomains.Any(d => uri.Host.Equals(d, StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith("." + d, StringComparison.OrdinalIgnoreCase));
        }

        bool IsBlocked(string url)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
            if (blockedUrls.Any(u => url.StartsWith(u, StringComparison.OrdinalIgnoreCase))) return true;
            // the host or any of its parent domains
            string host = uri.Host;
            while (true)
            {
                if (blockedDomains.Contains(host)) return true;
                int dot = host.IndexOf('.');
                if (dot < 0 || host.IndexOf('.', dot + 1) < 0) return false;
                host = host.Substring(dot + 1);
            }
        }

        /* ---------- Links ---------- */
        static bool IsInApp(string url) =>
            Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
            InApp.Any(h => uri.Host == h || uri.Host.EndsWith("." + h));

        static void OpenExternal(string url)
        {
            if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.ToString()) { UseShellExecute = true }); } catch { }
        }

        /* ---------- Window position ---------- */
        void LoadBounds()
        {
            try
            {
                var b = JsonNode.Parse(File.ReadAllText(boundsFile));
                var r = new Rectangle((int)b["x"], (int)b["y"], (int)b["w"], (int)b["h"]);
                if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r)))
                {
                    StartPosition = FormStartPosition.Manual;
                    Bounds = r;
                }
                if ((bool?)b["max"] == true) WindowState = FormWindowState.Maximized;
            }
            catch { }
        }

        void SaveBounds()
        {
            var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var b = new JsonObject { ["x"] = r.X, ["y"] = r.Y, ["w"] = r.Width, ["h"] = r.Height, ["max"] = WindowState == FormWindowState.Maximized };
            try { File.WriteAllText(boundsFile, b.ToJsonString()); } catch { }
        }
    }
}
