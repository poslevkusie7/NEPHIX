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
        You are an expert text editor. Your task is to find the last complete sentence in the given text and trim the text to that point.

        Here is an example:
        Input Text: "The solar system has eight planets. The largest is Jupiter. The planet Mars is often called the Red Pla"
        Correct Output: "The solar system has eight planets. The largest is Jupiter."

        Now, process the following text. Return ONLY the corrected text, with no explanations or extra words.

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
    long_text_to_split = (
        """
        ## The Root Cause: Stateless vs. Stateful Requests
Stateless (Correct for this task): Each API call is brand new and independent. The model only knows what you send in that single request. The Python script we wrote is designed to be stateless.

Stateful (Incorrect for this task): The API call includes previous messages, giving the model a "memory" of the conversation. This is useful for chatbots, but it's causing your current problem.

The output proves that a stateful request is being made, sending our conversation history to the model instead of just the specific text you want to fragment.

## How Is This Happening?
There are two likely scenarios causing this:

You're Using a Different Tool: Are you running the .py script directly from your terminal (e.g., python your_script.py)? Or are you copying the prompt and pasting it into a chat application, a web UI, or the Ollama command line (e.g., ollama run phi3)? Many of those tools are stateful by default and automatically include the conversation history.

The Code Was Changed: It's possible the payload in the generate_response function was modified to include more messages. For our task, it should be stateless and contain only the single prompt.
        I've created a comprehensive documentation for your document fragmentation system. The approach leverages your local Ollama setup with Llama/Phi models to intelligently split documents while maintaining semantic coherence.
Key aspects of the design:
Core Strategy: The system uses the LLM to identify natural breaking points in the text, ensuring each fragment is semantically complete rather than just mechanically split at arbitrary positions.
Flexibility: You can set target sizes, but the system prioritizes meaning over exact character counts, allowing fragments to be slightly larger/smaller to maintain coherence.
Local Processing: Everything runs on your Mac using Ollama, so no data leaves your system.
The implementation would involve:

A document processor to extract text from PDFs
An LLM interface to communicate with your Ollama models
A fragmentation engine that uses prompts to identify split points
Size management to balance target size with semantic completeness

Would you like me to start implementing specific parts of this system, or would you prefer to discuss any particular aspect in more detail? I can create the actual Python code for any component you'd like to begin with.
Excellent, the traceback you provided tells us exactly what is wrong. This is a very common issue.

The error 404 Client Error: Not Found for url: http://localhost:11434/api/chat is the key. It means your Python script is trying to send a request to the /api/chat endpoint, but your local Ollama server doesn't have that endpoint.

This almost always means you are running an older version of Ollama. The /api/chat endpoint is relatively new. Older versions used a different endpoint called /api/generate.

Because the script can't connect to the LLM, it falls back to the simple mechanical split, which is why the output quality is poor.

## Solution 1: Update Ollama (Recommended)
The best and most future-proof solution is to update your Ollama application to the latest version. This will give you access to the correct /api/chat endpoint and other improvements.

Open your terminal and run:
        """
    )

    # 2. Initialize the fragmenter with your desired model and settings
    fragmenter = TextFragmenter(model="llama3", target_size=400)

    # 3. Call the method to perform the task
    resulting_fragments = fragmenter.fragment(long_text_to_split)

    # 4. Print the results
    print("\n--- RESULTING FRAGMENTS ---")
    for frag in resulting_fragments:
        print(f"\n[ Fragment {frag['fragment_id']} | Size: {frag['size']} chars ]")
        print(frag['text'])