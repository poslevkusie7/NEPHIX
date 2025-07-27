import requests
import json
import os

class OllamaClient:
    """
    A client to communicate with a local Ollama LLM API.
    """
    def __init__(self, base_url="http://localhost:11434"):
        self.base_url = base_url 
        self.chat_endpoint = f"{self.base_url}/api/chat"

    def generate_response(self, prompt, model):
        """
        Sends a prompt to the Ollama API and gets a response.
        """
        try:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False
            }
            response = requests.post(self.chat_endpoint, json=payload)
            response.raise_for_status()
            return response.json()['message']['content']
        except requests.exceptions.RequestException as e:
            print(f"Error connecting to Ollama: {e}")
            print("Please ensure the Ollama application is running.")
            return None

class TextFragmenter:
    """
    A system that intelligently splits text into semantically coherent fragments using an LLM. 
    """
    def __init__(self, model="llama3", target_size=500):
        self.model = model
        self.target_size = target_size
        self.min_size = 100
        self.flexibility = 0.2
        self.ollama_client = OllamaClient()

    def _get_semantic_breakpoint(self, text_chunk):
        """
        Uses the LLM to find a natural breaking point, ensuring fragments end at complete thoughts. 
        """
        prompt = f"""
        You are an expert in text understanding. Your task is to find a natural breaking point in the following text chunk, ensuring it ends at a complete thought or sentence.
        Please return the text split up into fragments where it makes the most sense to split, while keeping the fragment as close to {self.target_size} characters as possible, Important is that thought is finished  
        Do not hallucinate, split text according requirements, don't change the text.

        Text: "{text_chunk}"
        """
        response = self.ollama_client.generate_response(prompt, self.model)
        return response if response else text_chunk

    def fragment(self, text_to_process):
        """
        Main fragmentation logic that processes a string of text.
        """
        print(f"Starting fragmentation with model '{self.model}'...")
        fragments = []
        current_position = 0
        fragment_id = 1

        while current_position < len(text_to_process):
            search_window = int(self.target_size * (1 + self.flexibility))
            candidate_chunk = text_to_process[current_position : current_position + search_window]

            if len(candidate_chunk) < self.min_size:
                if fragments:
                    fragments[-1]['text'] += " " + candidate_chunk
                    fragments[-1]['size'] = len(fragments[-1]['text'])
                else:
                    fragments.append({"fragment_id": fragment_id, "text": candidate_chunk, "size": len(candidate_chunk)})
                break

            final_fragment_text = self._get_semantic_breakpoint(candidate_chunk)

            if not final_fragment_text or len(final_fragment_text) < self.min_size:
                final_fragment_text = candidate_chunk[:self.target_size]

            fragment_size = len(final_fragment_text)
            fragments.append({"fragment_id": fragment_id, "text": final_fragment_text, "size": fragment_size})

            current_position += fragment_size
            fragment_id += 1

        print(f"Fragmentation complete. Generated {len(fragments)} fragments.")
        return fragments

# --- Example of How to Launch and Use ---
if __name__ == "__main__":
    # 1. The text you want to process
    with open('input.txt', 'r') as file:
        long_text_to_split = file.read()

    # 2. Initialize the fragmenter with your desired model and settings
    fragmenter = TextFragmenter(model="llama3", target_size=400)

    # 3. Call the method to perform the task
    resulting_fragments = fragmenter.fragment(long_text_to_split)

    # 4. Print the results
    print("\n--- RESULTING FRAGMENTS ---")
    for frag in resulting_fragments:
        print(f"\n[ Fragment {frag['fragment_id']} | Size: {frag['size']} chars ]")
        print(frag['text'])
    with open('output.json', 'w') as output_file:
        json.dump(resulting_fragments, output_file, indent=2)
    print("\nFragments saved to 'output.json'.")