YourMusicTutorial - Iowa Alto Sax sample splitter
===================================================

1. Put split_iowa_alto.py here:

   SaxTutorStudio\
       tools\
           split_iowa_alto.py

2. Your Iowa source files should already be here:

   frontend\static\audio\saxophone\alto\mf\

       AltoSax.NoVib.mf.Db3B3.aiff
       AltoSax.NoVib.mf.C4B4.aiff
       AltoSax.NoVib.mf.C5Ab5.aiff

3. Activate your virtual environment and install the two dependencies:

   pip install numpy soundfile

4. From the SaxTutorStudio project root run:

   python tools\split_iowa_alto.py

5. If successful, individual samples will be created here:

   frontend\static\audio\saxophone\alto\samples\mf\

   e.g.
       Db3.wav
       D3.wav
       Eb3.wav
       ...
       C4.wav
       Db4.wav
       D4.wav
       ...
       Ab5.wav

   There should be 32 WAV samples in total, plus split_report.txt.

6. Keep the original Iowa AIFF files untouched.

If the script reports that it detected the wrong number of notes,
copy the console output back into ChatGPT. The detector deliberately
stops rather than assigning the wrong pitch name to a sample.
