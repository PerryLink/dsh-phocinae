**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

<img src="docs/assets/logo_phocinae.png" width="120" alt="Phocinae सील लोगो">

# dsh-phocinae

**DeepSeek Harness के लिए स्थानीय, गैर-जनरेटिव निर्णय परत।** 150M मॉडल एक ही फ़ॉरवर्ड पास में हाँ/नहीं, एकल चयन और 2–10 स्कोर का उत्तर देता है, और fail-closed गेट टूल कॉल चलने से पहले उन्हें जाँचता है।

- आपकी मशीन पर चलता है; क्लाउड API या API key नहीं।
- `phocinae_ask` बैच टाइप्ड निर्णयों के लिए; `phocinae_gate` एक कमांड/कार्रवाई के लिए।
- गेट `tools/pre-execute` से जुड़ता है: सेवा उपलब्ध न हो तो व्यक्ति से पूछता है, चुपचाप अनुमति नहीं देता।
- मॉडल लेख या कोड नहीं लिखता; एक संरचित निर्णय देता है।

## त्वरित शुरुआत

```sh
pip install phocinae-server
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
PHOC_MODEL_DIR=./model python -m phocinae.main
dsh plugin --profile web add dsh-phocinae@0.2.5
curl http://127.0.0.1:8155/health
```

`{"status":"ok","model_loaded":true}` का अर्थ सेवा तैयार है। `dsh-phocinae@0.2.5` पिन करें: बिना वर्ज़न `add dsh-phocinae` pnpm के `minimumReleaseAge` के कारण पुरानी बिल्ड पर जा सकता है।

## आपको क्या मिलता है

| सतह | क्या करती है |
|---|---|
| `phocinae_ask` | एक state पर 64 तक टाइप्ड प्रश्न; उत्तर, कैलिब्रेटेड confidence और सलाहकारी `escalate` फ़्लैग। |
| `phocinae_gate` | एक कमांड/कार्रवाई को `allow`, `ask` या `deny` मानता है; चलाए बिना जाँचता है। |
| `tools/pre-execute` गेट | `gate.tools` से मेल खाने वाली हर टूल कॉल को चलने से पहले जाँचता है; fail-closed। |
| `phocinae` skill | मॉडल को बताती है कि स्थानीय निर्णय कब लें और `escalate` कैसे पढ़ें। |

## उदाहरण

एक state पर दो प्रश्न:

```json
{"state":"उपयोगकर्ता /tmp/build हटाना चाहता है। रास्ता workspace के अंदर है।","questions":[{"id":"safe","type":"noul","threshold":0.8},{"id":"urgency","type":"score"}]}
```

उत्तर का आकार:

```json
{"answers":{"safe":true,"urgency":4},"confidence":{"safe":0.92,"urgency":0.71},"escalate":false}
```

खतरनाक कमांड जाँचें:

```json
{"command":"rm -rf /","toolName":"shell","cwd":"/home/me/project"}
```

यह `decision: "deny"` कारण और confidence के साथ लौटाता है; कमांड कभी नहीं चलता। ये आउटपुट schema दिखाते हैं, रिकॉर्ड किया गया fixture नहीं।

## यह कैसे काम करता है

1. होस्ट `phocinae_ask`, `phocinae_gate` या pre-execute गेट कॉल करता है।
2. प्लगइन कच्चा state `http://127.0.0.1:8155/v1/systemone` पर भेजता है।
3. सेवा हर प्रश्न के लिए एक संरचित उत्तर देती है।
4. गेट उसे `allow` / `ask` / `deny` में बदलता है; कम confidence `escalate` बनती है, और सेवा न पहुँचे तो `failMode: closed` में `ask` बनता है।

## कॉन्फ़िगरेशन

डिफ़ॉल्ट `cordis.patch.yml` और `lib/config.mjs` में हैं। हर key का डिफ़ॉल्ट है।

| Key | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | निर्णय सेवा। `allowRemoteEndpoint: true` के बिना केवल loopback। |
| `timeoutMs` | `3000` | प्रति अनुरोध; एक प्रयास। |
| `escalateAt` | `0.6` | इससे कम confidence `escalate: true` करता है। |
| `gate.mode` | `harm` | `harm`, `tri-state`, `noul` या `off`. |
| `gate.tools` | `['*']` | जाँचने वाले टूल: सटीक नाम, glob या `*`. |
| `gate.failMode` | `closed` | सेवा न पहुँचे तो `closed` व्यक्ति से पूछता है; `open` अनुमति देता है। |

केवल टूल चलाएँ, गेट बंद रखें:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

## सुरक्षा और सीमाएँ

- **केवल loopback।** state में कच्चा टूल कॉल टेक्स्ट है; स्पष्ट अनुमति के बिना गैर-loopback endpoint लोड त्रुटि है।
- **Fail-closed।** सेवा त्रुटि/timeout जाँची गई कॉल व्यक्ति को भेजती है; अनुपस्थित टूल नाम सुरक्षित नहीं माना जाता।
- **यह sandbox नहीं है।** गेट अतिरिक्त अनुमोदन संकेत है, होस्ट sandbox या मानव अनुमोदन का विकल्प नहीं।
- **सामग्री नहीं बनाता।** मॉडल ज्ञान प्रश्न, कोड या सारांश नहीं देता; उसके लिए chat मॉडल लें।

## संगतता

- Node `^22.19` या `>=24`.
- DSH `>=0.2.1-0 <0.3.0`; bundle पंक्ति `phocinae_ask`, `phocinae_gate`, गेट और skill माउंट करती है।
- `phocinae-server` कॉन्फ़िगर किए endpoint पर पहुँचना चाहिए।

## समस्या निवारण

| लक्षण | समाधान |
|---|---|
| `PHOCINAE_SERVICE_UNAVAILABLE` | सेवा शुरू करें और `curl http://127.0.0.1:8155/health` जाँचें। |
| बिना वर्ज़न add पुराना वर्ज़न लाता है | `dsh-phocinae@0.2.5` से फिर इंस्टॉल करें; `dsh --profile web --dump-config` देखें। |
| गेट हर चीज़ पूछता है | सेवा चल रही है या नहीं देखें; `failMode: closed` में सेवा बंद होना जानबूझकर पूछता है। |
| गेट बहुत सख्त/ढीला है | `gate.mode`, `gate.tools`, `gate.minConfidence`, `gate.autoAllow` समायोजित करें; बिना सोचे बंद न करें। |

## लाइसेंस

Apache-2.0. मॉडल कार्ड और सर्वर अलग परियोजनाएँ हैं: [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) और [phocinae-server](https://github.com/Phocinae/phocinae-server).
