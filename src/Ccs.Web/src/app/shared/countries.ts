/** Every country: ISO code | calling code | local mobile length | what local mobiles start with.
 *  Length and starts are filled where known; for the rest the admin types them once (Settings → System → Phone numbers).
 *  Names come from the browser (Intl.DisplayNames), so they show in English or Arabic. */
const RAW = `AF|93|10|07;AL|355|10|06;DZ|213|10|05,06,07;AS|1684;AD|376;AO|244|9|9;AI|1264;AG|1268;AR|54;AM|374;AW|297;AU|61|10|04;AT|43;AZ|994;
BS|1242;BH|973|8|3,6;BD|880|11|01;BB|1246;BY|375;BE|32|10|04;BZ|501;BJ|229;BM|1441;BT|975;BO|591;BA|387;BW|267;BR|55|11;BN|673;BG|359;BF|226;BI|257;
KH|855;CM|237|9|6;CA|1|10;CV|238;KY|1345;CF|236;TD|235;CL|56|9|9;CN|86|11|1;CO|57|10|3;KM|269|7;CG|242;CD|243;CK|682;CR|506|8;HR|385;CU|53;CY|357|8|9;CZ|420|9;
DK|45|8;DJ|253|8|77;DM|1767;DO|1809;EC|593|10|09;EG|20|11|01;SV|503|8;GQ|240;ER|291;EE|372;SZ|268;ET|251|10|09,07;FJ|679;FI|358;FR|33|10|06,07;GF|594;PF|689;
GA|241;GM|220;GE|995|9|5;DE|49;GH|233|10|02,05;GI|350;GR|30|10|69;GL|299;GD|1473;GP|590;GU|1671;GT|502|8;GN|224;GW|245;GY|592;HT|509;HN|504|8;HK|852|8;HU|36;
IS|354|7;IN|91|10|6,7,8,9;ID|62;IR|98|11|09;IQ|964|11|07;IE|353|10|08;IL|972|10|05;IT|39;CI|225|10;JM|1876;JP|81|11|070,080,090;JO|962|10|07;KZ|7;KE|254|10|07,01;
KI|686;XK|383;KW|965|8|4,5,6,9;KG|996;LA|856;LV|371|8|2;LB|961|8|03,7,81;LS|266;LR|231;LY|218|10|09;LI|423;LT|370;LU|352;MO|853|8;MG|261;MW|265;MY|60;MV|960|7;
ML|223;MT|356|8;MH|692;MQ|596;MR|222|8|2,3,4;MU|230|8|5;MX|52|10;FM|691;MD|373;MC|377;MN|976|8;ME|382;MS|1664;MA|212|10|06,07;MZ|258|9|8;MM|95;NA|264;NR|674;
NP|977|10|9;NL|31|10|06;NC|687;NZ|64;NI|505|8;NE|227;NG|234|11|07,08,09;KP|850;MK|389;NO|47|8|4,9;OM|968|8|7,9;PK|92|11|03;PW|680;PS|970|10|05;PA|507|8|6;PG|675;
PY|595;PE|51|9|9;PH|63|11|09;PL|48|9;PT|351|9|9;PR|1787;QA|974|8|3,5,6,7;RE|262;RO|40|10|07;RU|7|11|89;RW|250|10|07;KN|1869;LC|1758;VC|1784;WS|685;SM|378;ST|239;
SA|966|10|05;SN|221|9|7;RS|381;SC|248;SL|232;SG|65|8|8,9;SK|421|10|09;SI|386;SB|677;SO|252;ZA|27|10|06,07,08;KR|82|11|010;SS|211;ES|34|9|6,7;LK|94|10|07;
SD|249|10|09,01;SR|597;SE|46|10|07;CH|41|10|07;SY|963|10|09;TW|886|10|09;TJ|992;TZ|255|10|06,07;TH|66|10|06,08,09;TL|670;TG|228;TO|676;TT|1868;TN|216|8|2,4,5,9;
TR|90|11|05;TM|993;TC|1649;TV|688;UG|256|10|07;UA|380|10|0;AE|971|10|05;GB|44|11|07;US|1|10;UY|598;UZ|998|9;VU|678;VA|379;VE|58|11|04;VN|84|10|0;VG|1284;VI|1340;
YE|967|9|7;ZM|260|10|09,07;ZW|263|10|07`;

export interface Country { iso: string; code: string; length: number | null; starts: string[] }

export const COUNTRIES: Country[] = RAW.replace(/\s+/g, '').split(';').map((r) => {
  const [iso, code, len = '', starts = ''] = r.split('|');
  return { iso, code: '+' + code, length: len ? Number(len) : null, starts: starts ? starts.split(',') : [] };
});

/** The country's name in the page language; the ISO code when the browser does not know it. */
export function countryName(iso: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(iso) ?? iso; } catch { return iso; }
}
