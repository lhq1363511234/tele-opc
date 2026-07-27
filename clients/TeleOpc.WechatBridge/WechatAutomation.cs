using System.Diagnostics; using System.Security.Cryptography; using System.Text; using FlaUI.Core; using FlaUI.Core.Definitions; using FlaUI.UIA3;
namespace TeleOpc.WechatBridge;
public sealed class WechatAutomation:IDisposable {
 UIA3Automation? automation; FlaUI.Core.Application? app; string? lastFingerprint;
 public bool Connect(){var p=Process.GetProcesses().FirstOrDefault(x=>x.ProcessName.Equals("Weixin",StringComparison.OrdinalIgnoreCase)||x.ProcessName.Equals("WeChat",StringComparison.OrdinalIgnoreCase));if(p is null)return false;automation=new UIA3Automation();app=FlaUI.Core.Application.Attach(p);return true;}
 public WechatInbound? ReadCurrentConversation(){var w=app?.GetMainWindow(automation);if(w is null)return null;var selected=w.FindAllDescendants(cf=>cf.ByControlType(ControlType.ListItem)).FirstOrDefault(x=>x.Patterns.SelectionItem.IsSupported&&x.Patterns.SelectionItem.Pattern.IsSelected.Value);var name=selected?.Name?.Trim();var texts=w.FindAllDescendants(cf=>cf.ByControlType(ControlType.Text)).Select(x=>x.Name?.Trim()).Where(x=>!string.IsNullOrWhiteSpace(x)).ToList();var text=texts.LastOrDefault();if(string.IsNullOrWhiteSpace(name)||string.IsNullOrWhiteSpace(text))return null;var fp=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(name+"\n"+text)));if(fp==lastFingerprint)return null;lastFingerprint=fp;return new(fp,name,name,text,false,DateTimeOffset.UtcNow.ToString("O"));}
 public bool Send(OutboxItem item){var w=app?.GetMainWindow(automation);if(w is null)return false;var selected=w.FindAllDescendants(cf=>cf.ByControlType(ControlType.ListItem)).FirstOrDefault(x=>x.Name?.Trim()==item.conversation_name);selected?.Click();Thread.Sleep(300);var edit=w.FindAllDescendants(cf=>cf.ByControlType(ControlType.Edit)).LastOrDefault();if(edit is null)return false;edit.Focus();Clipboard.SetText(item.text);SendKeys.SendWait("^v");SendKeys.SendWait("{ENTER}");return true;}
 public string Diagnose(){
  var w=app?.GetMainWindow(automation)??throw new InvalidOperationException("微信未连接");
  var path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop),$"wechat-uia-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
  var lines=new List<string>{
   "Tele-OPC WeChat UIA diagnostic",
   $"Generated: {DateTimeOffset.Now:O}",
   $"ProcessId: {Safe(()=>app?.ProcessId.ToString())}",
   "Columns: Index | Depth | ControlType | AutomationId | ClassName | Name | Bounds | Offscreen | Enabled | Error",
   ""
  };
  var elements=new[]{w}.Concat(w.FindAllDescendants()).Take(5001).ToArray();
  for(var i=0;i<elements.Length;i++){
   var x=elements[i];
   var errors=new List<string>();
   string Read(string label,Func<string?> getter){try{return Sanitize(getter());}catch(Exception e){errors.Add($"{label}:{e.GetType().Name}");return "<unsupported>";}}
   var depth=Read("Depth",()=>GetDepth(x).ToString());
   var type=Read("ControlType",()=>x.ControlType.ToString());
   var automationId=Read("AutomationId",()=>x.AutomationId);
   var className=Read("ClassName",()=>x.ClassName);
   var name=Read("Name",()=>x.Name);
   var bounds=Read("Bounds",()=>x.BoundingRectangle.ToString());
   var offscreen=Read("Offscreen",()=>x.Properties.IsOffscreen.ValueOrDefault.ToString());
   var enabled=Read("Enabled",()=>x.Properties.IsEnabled.ValueOrDefault.ToString());
   lines.Add($"{i:D4} | {depth} | {type} | {automationId} | {className} | {name} | {bounds} | {offscreen} | {enabled} | {string.Join(',',errors)}");
  }
  if(elements.Length>5000)lines.Add("TRUNCATED: more than 5000 UI Automation elements.");
  File.WriteAllLines(path,lines,Encoding.UTF8);
  return path;
 }
 static int GetDepth(FlaUI.Core.AutomationElements.AutomationElement element){
  var depth=0;var current=element;
  while(depth<64){var parent=current.Parent;if(parent is null)break;depth++;current=parent;}
  return depth;
 }
 static string? Safe(Func<string?> getter){try{return getter();}catch(Exception e){return $"<unsupported:{e.GetType().Name}>";}}
 static string Sanitize(string? value)=>string.IsNullOrEmpty(value)?"":value.Replace("\r","\\r").Replace("\n","\\n").Replace("|","¦");
 public void Dispose(){automation?.Dispose();app?.Dispose();}
}
