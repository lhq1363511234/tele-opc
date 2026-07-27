using System.Text.Json;
namespace TeleOpc.WechatBridge;
public sealed class BridgeSettings {
 public string ServerUrl {get;set;}="https://opctoai.xyz"; public string DeviceToken{get;set;}="";
 public bool AutoReply{get;set;}=true; public bool Groups{get;set;}=false; public int PollSeconds{get;set;}=3;
 public static string FilePath=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TeleOpc","WechatBridge","settings.json");
 public static BridgeSettings Load(){foreach(var path in new[]{FilePath,Path.Combine(AppContext.BaseDirectory,"bridge-config.json")}){try{if(File.Exists(path))return JsonSerializer.Deserialize<BridgeSettings>(File.ReadAllText(path))??new();}catch{}}return new();}
 public void Save(){Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);File.WriteAllText(FilePath,JsonSerializer.Serialize(this,new JsonSerializerOptions{WriteIndented=true}));}
}
