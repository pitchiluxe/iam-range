# AD Enterprise Lab Series

Desktop app **AD Enterprise Lab** (🏢). It builds TechnoBiz's first domain, `corp.technobiz.local`, starting from two bare machines. Then it breaks the domain the way real domains break.

```
INTERNET ── NIC "Internet" (DHCP from home router)
                 │
               DC01  (Server 2019: AD DS, DNS, DHCP, RAS/NAT)
                 │
            NIC "Internal" 172.16.0.1/24 · no gateway · DNS 127.0.0.1
                 │
            NIC "Ethernet" (DHCP 172.16.0.100–200 from DC01)
                 │
             CLIENT01 (Windows 10)
```

| # | Lab | Default mode |
|---|-----|--------------|
| 01 | DC01 server networking | Guided |
| 02 | Deploy AD DS and DNS | Guided |
| 03 | RAS / NAT routing | Coach |
| 04 | DHCP configuration | Coach |
| 05 | Join CLIENT01 to the domain (the night-shift build left DNS on 8.8.8.8) | Coach |
| 06 | OU architecture | Coach |
| 07 | Users and security groups | Coach |
| 08 | Group Policy baseline | Coach |
| 09 | Finance share permissions | Coach |
| 10 | Help desk INC-1047: sign-in failure | Real-World |
| 11 | Help desk INC-1052: workstation cannot reach the domain | Real-World |

You can start any lab on its own. The lab's starting state comes from replaying the reference solutions of every earlier lab through the same command engine that you type into.

## Two environments

| Environment | Where you work | What Check My Work grades |
|---|---|---|
| **Simulated lab** | The DC01 and CLIENT01 consoles in the window | The simulated state |
| **Real VMs (VirtualBox)** | Two real Windows VMs built by `omari-lab/10-AD-ENTERPRISE-VBOX/` | The real VMs, read without changing them (`realVm.ts`) |

Both environments are graded by the same checks.

## Starting over

The **Start over ▾** menu is available at any time, in both environments.

| | Simulated | Real VMs |
|---|---|---|
| **Restart this lab** | Rebuilds this lab's starting machines and clears its progress | Restores snapshot `LabNN-Start` |
| **Restart the whole series** | Clears every lab and all completion marks, then goes back to Lab 01 | Restores `Lab01-Start` (fresh Windows) and clears progress |
| **Save this lab's start point** | — | Snapshots the VMs as `LabNN-Start` |

On the real VMs, passing a lab offers to save the next lab's start point.

## Three roles

| Role | Code | Can change the lab? |
|------|------|---------------------|
| **Administrator** (you) | `src/vm/adlab/commands.ts`: the DC01 and CLIENT01 consoles | Yes. This is the only thing that can. |
| **Examiner** | `src/vm/adlab/validation.ts`: deterministic checks such as `validateDCNetworking()`, `validateDHCP()` and `validateDomainJoin()` | No |
| **Instructor** | `src/vm/adlab/instructor.ts`: the Ollama instructor | No. It gets a deep-frozen snapshot (`observe.ts`) and imports nothing that writes. |

**Check My Work** runs the examiner first. The examiner's results go to the instructor, which explains them. Only the examiner can mark a lab complete.

## Instructor

- **Modes:** Guided, Coach, Interview and Real-World.
- **Hints:** each check has three hints: Direction, then Investigation, then Concept. None of them is the fix.
- **Explaining the fix:** the instructor will describe the fix in words after the third hint, after three failed checks on the same item, or in Guided mode. You still make the change yourself.
- **Lab memory:** the instructor reads your command history. For example: "ping to DC01 works but nslookup fails, so this is DNS, not the network."
- **Real-World mode:** the instructor coaches from what you have found. It is not shown the state that contains the answer.
- **Model:** the instructor uses the model chosen in **Settings → AI Assistant**. That list shows the models installed in your local Ollama. If the chosen model isn't installed, the instructor uses whichever installed model fits best.
- **Without Ollama:** the badge reads **Ollama Instructor Offline**. The lab and validation still work, and the offline instructor answers from the lab material.
