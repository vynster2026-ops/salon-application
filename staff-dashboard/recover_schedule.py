import json
import os

log_path = r"C:\Users\S Pavani\.gemini\antigravity-ide\brain\113790f0-c75f-47a1-8ed8-d018b0862bf7\.system_generated\logs\transcript.jsonl"
target_file = r"c:\Users\S Pavani\OneDrive\Desktop\staf-final\salonstaffnew (3)\salonstaffnew\salon-staff-dashboard - Copy (2)\schedule.html"

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            step = json.loads(line)
            # dump any tool calls with view_file
            if 'tool_calls' in step:
                for res in step.get('tool_calls', []):
                    if 'response' in res and 'output' in res['response']:
                        output = res['response']['output']
                        if 'schedule.html' in output and 'Total Lines: 544' in output:
                            lines = output.split('\n')
                            restored_lines = []
                            is_code = False
                            for l in lines:
                                if "The following code has been modified" in l:
                                    is_code = True
                                    continue
                                if "The above content shows the entire" in l:
                                    break
                                if is_code:
                                    if ': ' in l:
                                        parts = l.split(': ', 1)
                                        if parts[0].isdigit():
                                            restored_lines.append(parts[1])
                                        else:
                                            restored_lines.append(l)
                                    else:
                                        restored_lines.append(l)
                            with open(target_file, 'w', encoding='utf-8') as out_f:
                                out_f.write('\n'.join(restored_lines))
                            print("Restored successfully from tool_calls.")
                            exit(0)
        except Exception as e:
            print("Error parsing line", e)
print("Could not find or restore the file.")
