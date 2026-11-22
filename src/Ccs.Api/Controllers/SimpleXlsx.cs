using System.IO.Compression;
using System.Security;
using System.Text;

namespace Ccs.Api.Controllers;

/// <summary>
/// A plain .xlsx (Office Open XML) with one or more sheets of text and numbers, bold first row, no styles beyond that.
/// Small on purpose: the security report is the only download that needs it, so no spreadsheet package is added.
/// </summary>
public static class SimpleXlsx
{
    public sealed record Sheet(string Name, IReadOnlyList<IReadOnlyList<object?>> Rows);

    public static byte[] Build(IReadOnlyList<Sheet> sheets)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            void Put(string path, string xml)
            {
                using var w = new StreamWriter(zip.CreateEntry(path, CompressionLevel.Optimal).Open(), new UTF8Encoding(false));
                w.Write(xml);
            }
            var overrides = new StringBuilder();
            for (var i = 1; i <= sheets.Count; i++)
                overrides.Append($"<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
            Put("[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"
                + overrides + "</Types>");
            Put("_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            var sheetList = new StringBuilder(); var rels = new StringBuilder();
            for (var i = 1; i <= sheets.Count; i++)
            {
                sheetList.Append($"<sheet name=\"{Esc(SheetName(sheets[i - 1].Name))}\" sheetId=\"{i}\" r:id=\"rId{i}\"/>");
                rels.Append($"<Relationship Id=\"rId{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>");
            }
            rels.Append($"<Relationship Id=\"rId{sheets.Count + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
            Put("xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>"
                + sheetList + "</sheets></workbook>");
            Put("xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" + rels + "</Relationships>");
            Put("xl/styles.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
                + "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>"
                + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
                + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
                + "<cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs></styleSheet>");
            for (var i = 1; i <= sheets.Count; i++)
            {
                var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
                var rows = sheets[i - 1].Rows;
                for (var r = 0; r < rows.Count; r++)
                {
                    sb.Append($"<row r=\"{r + 1}\">");
                    for (var c = 0; c < rows[r].Count; c++)
                    {
                        var refName = Col(c) + (r + 1);
                        var style = r == 0 ? " s=\"1\"" : "";
                        switch (rows[r][c])
                        {
                            case null: break;
                            case int or long or double or decimal:
                                sb.Append($"<c r=\"{refName}\"{style}><v>{Convert.ToString(rows[r][c], System.Globalization.CultureInfo.InvariantCulture)}</v></c>"); break;
                            default:
                                sb.Append($"<c r=\"{refName}\"{style} t=\"inlineStr\"><is><t xml:space=\"preserve\">{Esc(Convert.ToString(rows[r][c], System.Globalization.CultureInfo.InvariantCulture) ?? "")}</t></is></c>"); break;
                        }
                    }
                    sb.Append("</row>");
                }
                sb.Append("</sheetData></worksheet>");
                Put($"xl/worksheets/sheet{i}.xml", sb.ToString());
            }
        }
        return ms.ToArray();
    }

    private static string Col(int i) { var s = ""; for (i++; i > 0; i = (i - 1) / 26) s = (char)('A' + (i - 1) % 26) + s; return s; }

    /// <summary>XML-escapes text and drops control characters a spreadsheet cannot hold.</summary>
    private static string Esc(string s) => SecurityElement.Escape(new string(s.Where(ch => ch >= ' ' || ch is '\t' or '\n' or '\r').ToArray())) ?? "";

    private static string SheetName(string n) { var s = new string(n.Where(ch => !"[]:*?/\\".Contains(ch)).ToArray()); return s.Length > 31 ? s[..31] : s; }
}
