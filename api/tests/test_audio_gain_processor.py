import pytest
import numpy as np
from pipecat.frames.frames import InputAudioRawFrame, UserAudioRawFrame, TextFrame
from pipecat.processors.frame_processor import FrameDirection
from api.services.pipecat.audio_gain_processor import AudioGainProcessor

@pytest.mark.asyncio
async def test_audio_gain_processor_scales_audio():
    processor = AudioGainProcessor(gain_factor=1.5)
    
    original_samples = np.array([100, -200, 1000, -2000], dtype=np.int16)
    frame = InputAudioRawFrame(
        audio=original_samples.tobytes(),
        sample_rate=16000,
        num_channels=1
    )
    
    pushed_frames = []
    
    async def mock_push_frame(f, direction):
        pushed_frames.append(f)
        
    processor.push_frame = mock_push_frame
    
    await processor.process_frame(frame, FrameDirection.DOWNSTREAM)
    
    assert len(pushed_frames) == 1
    out_frame = pushed_frames[0]
    assert isinstance(out_frame, InputAudioRawFrame)
    
    out_samples = np.frombuffer(out_frame.audio, dtype=np.int16)
    expected_samples = (original_samples * 1.5).astype(np.int16)
    np.testing.assert_array_equal(out_samples, expected_samples)

@pytest.mark.asyncio
async def test_audio_gain_processor_clips_audio():
    processor = AudioGainProcessor(gain_factor=2.0)
    
    original_samples = np.array([25000, -25000], dtype=np.int16)
    frame = UserAudioRawFrame(
        audio=original_samples.tobytes(),
        sample_rate=16000,
        num_channels=1
    )
    
    pushed_frames = []
    
    async def mock_push_frame(f, direction):
        pushed_frames.append(f)
        
    processor.push_frame = mock_push_frame
    
    await processor.process_frame(frame, FrameDirection.DOWNSTREAM)
    
    out_frame = pushed_frames[0]
    out_samples = np.frombuffer(out_frame.audio, dtype=np.int16)
    
    expected_samples = np.array([32767, -32768], dtype=np.int16)
    np.testing.assert_array_equal(out_samples, expected_samples)

@pytest.mark.asyncio
async def test_audio_gain_processor_passes_other_frames():
    processor = AudioGainProcessor(gain_factor=1.5)
    frame = TextFrame(text="Hello")
    
    pushed_frames = []
    
    async def mock_push_frame(f, direction):
        pushed_frames.append(f)
        
    processor.push_frame = mock_push_frame
    
    await processor.process_frame(frame, FrameDirection.DOWNSTREAM)
    
    assert len(pushed_frames) == 1
    assert pushed_frames[0] is frame
