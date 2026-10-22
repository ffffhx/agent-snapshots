"""Local-only JSONL RPC. stdout is protocol; model diagnostics go to stderr."""
import contextlib
from collections import OrderedDict
import json
import os
from pathlib import Path
import re
import sys
import unicodedata

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
with contextlib.redirect_stdout(sys.stderr):
    import torch
    import hanlp
    torch.set_num_threads(2)
    model = hanlp.load(hanlp.pretrained.tok.FINE_ELECTRA_SMALL_ZH, devices=-1)
    dictionary = json.loads(Path(__file__).with_name("terms.json").read_text(encoding="utf-8"))
    model.dict_combine = set(dictionary)

STOP = set("我 我们 你 你们 的 了 吗 呢 啊 是 在 和 与 及 或 把 被 有 一个 这个 那个 怎么 如何 什么 为什么 之前 以前 上次 最后 请 帮 帮我 一下 问题 the a an is are was were how what why did do does i we it to of in for and please".split())
# Protect complete ASCII identifiers/paths. HanLP handles Chinese runs with
# sentence context; code expansions are added only to indexed documents.
SPANS = re.compile(r"[\u3400-\u9fff]+|[A-Za-z0-9_]+(?:[./:\\\-][A-Za-z0-9_]+)*")
SEGMENT_CACHE = OrderedDict()


def analyze(texts, query):
    spans = [SPANS.findall(unicodedata.normalize("NFKC", text)) for text in texts]
    chinese = list(dict.fromkeys(s for row in spans for s in row if '\u3400' <= s[0] <= '\u9fff'))
    missing = [s for s in chinese if s not in SEGMENT_CACHE]
    pieces = [s[i:i + 200] for s in missing for i in range(0, len(s), 200)]
    segmented = []
    with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
        for start in range(0, len(pieces), 64):
            segmented.extend(model(pieces[start:start + 64]))
    mapped = {s: SEGMENT_CACHE[s] for s in chinese if s in SEGMENT_CACHE}
    cursor = 0
    for s in missing:
        count = (len(s) + 199) // 200
        mapped[s] = [word for row in segmented[cursor:cursor + count] for word in row]
        cursor += count
        if len(s) <= 400:
            SEGMENT_CACHE[s] = mapped[s]
            if len(SEGMENT_CACHE) > 4096:
                SEGMENT_CACHE.popitem(last=False)
    result = []
    for row in spans:
        tokens = []
        for s in row:
            if s in mapped:
                for word in mapped[s]:
                    if word not in STOP:
                        tokens.append(word)
                        if not query:
                            tokens.extend(dictionary.get(word, []))
            else:
                forms = [s.lower()]
                if not query:
                    # Preserve basenames as well as full paths (including dots
                    # and underscores), so searching rag_service.ts finds a path.
                    forms.extend(re.split(r"[/\\:]", s.lower()))
                    forms.extend(re.split(r"[./\\:\-]", s.lower()))
                    separated = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s)
                    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", separated)
                    forms.extend(re.findall(r"[a-z0-9]+", separated.lower()))
                tokens.extend(t for t in dict.fromkeys(forms) if t and t not in STOP)
        result.append(list(dict.fromkeys(tokens)) if query else tokens)
    return result


if "--check" in sys.argv:
    print(json.dumps(analyze(["排查数据库连接池耗尽 getUserSession rag_service.ts"], False), ensure_ascii=False))
else:
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = analyze(request["texts"], request.get("query", False))
            print(json.dumps({"id": request["id"], "tokens": result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id"), "error": str(error)}, ensure_ascii=False), flush=True)
