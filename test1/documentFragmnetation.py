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
    long_text_to_split = (
        """
Israeli politics is a vibrant, complex, and often turbulent field, shaped by a unique blend of historical legacies, religious and ethnic diversity, ongoing conflict, and democratic principles. Since its establishment in 1948, the State of Israel has developed a robust political system grounded in parliamentary democracy. Yet, the country’s politics are deeply influenced by ideological divisions, security concerns, demographic tensions, and a multiparty system that often results in unstable coalitions. To understand Israeli politics today, one must examine its historical roots, institutional structure, and contemporary challenges.

Historical Foundations and Institutional Framework

The modern Israeli political system emerged after the declaration of independence in 1948, influenced by both European democratic traditions and the practical needs of a new state facing existential threats. The Knesset, Israel’s unicameral parliament, serves as the legislative body and consists of 120 members elected through proportional representation. This system encourages the formation of multiple parties representing a wide range of political, religious, and ethnic identities.

The head of state is the president, a largely ceremonial role, while real executive power lies with the prime minister. Since no single party has ever gained a majority in the Knesset, coalitions are a necessity. As a result, even small parties can wield considerable influence, often leading to fragmented and unstable governments.

Major Political Parties and Ideological Divides

Israel’s political landscape features a broad ideological spectrum, ranging from secular liberalism to ultra-Orthodox Judaism, and from socialist Zionism to religious nationalism. Among the most influential parties are:
	•	Likud: A center-right to right-wing party led for many years by Benjamin Netanyahu. Likud supports a strong national defense, free-market economics, and a skeptical approach to the peace process with the Palestinians.
	•	Yesh Atid: A centrist, secular party led by Yair Lapid, advocating for civil rights, middle-class economic relief, and limits on religious influence in public life.
	•	Labor Party (Avoda): Historically dominant, the Labor Party promoted socialist and Zionist values but has declined in recent decades.
	•	Religious Zionist Parties: Such as Shas, United Torah Judaism, and Religious Zionism, these parties focus on preserving Jewish religious identity and often support settlement expansion in the West Bank.
	•	Arab Parties: Including Ra’am and Hadash-Ta’al, these represent Israel’s Arab minority, advocating for civil equality, Palestinian rights, and social justice.

The Role of Religion and Ethnicity

Religion plays a major role in Israeli politics, influencing debates over civil marriage, Sabbath observance, public transportation, and military service exemptions for yeshiva students. Tensions between secular and religious Jews often surface in public discourse and coalition negotiations.

Ethnic divisions also affect politics. Israeli society includes Ashkenazi (European-origin) Jews, Mizrahi (Middle Eastern-origin) Jews, Ethiopian Jews, Russian-speaking immigrants, secular and religious communities, and approximately 20% Arab citizens of Israel. Each group brings distinct political preferences and experiences of inclusion or marginalization.

The Israeli-Palestinian Conflict

At the heart of Israeli politics lies the unresolved Israeli-Palestinian conflict. Political parties diverge sharply on how to address this issue. The left typically supports a two-state solution, negotiations, and territorial compromise, while the right favors security-first approaches, settlement expansion, and maintaining Israeli control over the West Bank.

In recent years, the conflict has been overshadowed by domestic concerns, though periodic escalations—such as conflicts in Gaza or tensions in Jerusalem—reignite debate. Peace talks have largely stalled, and political discourse has shifted toward managing the conflict rather than resolving it.

Recent Political Turmoil

The last decade has seen extraordinary political instability. Between 2019 and 2022, Israel held five elections due to deadlocked results and the inability to form stable coalitions. Central to this crisis was the polarizing figure of Benjamin Netanyahu, who faced corruption charges but remained a dominant force. His allies framed the legal cases as a political witch hunt, while opponents argued for the rule of law and judicial independence.

In 2021, an unprecedented “change government” was formed, including right-wing, centrist, left-wing, and even an Arab party (Ra’am) in a fragile coalition. Although it ended Netanyahu’s long rule, it lasted just over a year. In late 2022, Netanyahu returned to power with a far-right coalition, raising concerns domestically and internationally.

Judicial Reform and Public Protests

One of the most contentious issues in recent Israeli politics is judicial reform. The Netanyahu-led government proposed significant changes to the judicial system, including limiting the Supreme Court’s power to review legislation and increasing political control over judicial appointments. Critics argue this threatens democratic checks and balances and weakens protections for minority rights.

Massive public protests erupted throughout 2023, uniting a broad swath of Israeli society—secular, religious, tech workers, reservists, and students—in opposition to the reforms. The protests were among the largest in Israeli history and highlighted deep societal divides over the country’s democratic identity.

Future Outlook

Israeli politics remains dynamic and unpredictable. Key questions loom over the future: Will judicial reforms proceed? Can the country maintain democratic norms amid internal strife? How will regional normalization with Arab states affect the Palestinian issue? Can trust be restored between Israel’s diverse communities?

While the political system has proven resilient, the strain of persistent instability, identity conflicts, and lack of consensus on core issues pose long-term challenges. At the same time, Israel remains a hub of innovation, cultural vibrancy, and civic engagement, suggesting that its political system, though often chaotic, retains the capacity for adaptation and renewal.

Conclusion

Politics in Israel reflect the complexity of a nation shaped by history, conflict, and diversity. With passionate public engagement, a wide ideological range, and pressing domestic and international challenges, Israeli democracy is both vibrant and vulnerable. Understanding its dynamics requires attentiveness to its internal divisions, democratic institutions, and the aspirations of its people—Jewish and Arab, religious and secular, left and right—who together shape the ongoing story of the Israeli state.
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